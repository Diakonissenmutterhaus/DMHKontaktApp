using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Broker;

// Private pipe protocol with the native app. Never invoke this helper with
// inherited stdout: the success response carries an access token in memory.
// WAM owns renewal credentials; no cache file, password, logout or Graph calls.
internal static class Program
{
    internal sealed record Request(string ClientId, string TenantId, string[] Scopes,
        string? HomeAccountId, long WindowHandle, string? LoginHint = null, bool AllowInteractive = false,
        string? Operation = null, string[]? AccountAliases = null);
    internal sealed record Response(string Status, string? AccessToken = null,
        string? HomeAccountId = null, long ExpiresIn = 0, string? ErrorCode = null, string? VerifiedEmail = null,
        int? WorkAccountCount = null, int? MatchingAccountCount = null, LoginDiagnostic? Diagnostic = null);
    internal sealed record LoginPlan(IAccount? Account, string[] Aliases, string Source,
        string? ErrorCode = null, bool AllowWindowsFallback = false);
    internal sealed record SilentAttempt(string Kind, string Status, string? ErrorCode = null, string? CorrelationId = null);
    internal sealed class LoginDiagnostic
    {
        public string? ClientId { get; init; }
        public string? TenantId { get; init; }
        public string Stage { get; set; } = "office_metadata";
        public bool? OfficeReadComplete { get; set; }
        public int? OfficeIdentityCount { get; set; }
        public int? AvailableAccountCount { get; set; }
        public int? TenantAccountCount { get; set; }
        public bool? WindowsRegistrationReadComplete { get; set; }
        public int? WindowsRegistrationCount { get; set; }
        public string SelectionSource { get; set; } = "not_selected";
        public string? SelectedEmail { get; set; }
        public List<SilentAttempt> Attempts { get; } = [];
    }
    static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    // Never choose the first account from a list. Renewal is pinned to the
    // original account; conflicting identities matching Office aliases are rejected.
    internal static IAccount? SelectAccount(IAccount[] accounts, string tenantId, string? homeAccountId, string[]? loginHints = null)
    {
        var unique = accounts.DistinctBy(account => account.HomeAccountId.Identifier).ToArray();
        if (!string.IsNullOrEmpty(homeAccountId))
            return unique.SingleOrDefault(account => account.HomeAccountId.Identifier == homeAccountId);
        var matching = unique.Where(account => string.Equals(account.HomeAccountId.TenantId, tenantId, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (loginHints is { Length: > 0 }) {
            var known = unique.Where(account => loginHints.Contains(account.Username, StringComparer.OrdinalIgnoreCase)).ToArray();
            if (known.Length == 1) return known[0];
            // Conflicting broker identities must not be hidden by a Windows-default fallback.
            return known.Length == 0 ? PublicClientApplication.OperatingSystemAccount : null;
        }
        return matching.Length == 1 ? matching[0] : PublicClientApplication.OperatingSystemAccount;
    }

    internal static bool IdentityMatches(IAccount? account, string? pinned, string[]? hints) =>
        account is not null && !string.IsNullOrEmpty(account.HomeAccountId.Identifier)
        && (string.IsNullOrEmpty(pinned) || account.HomeAccountId.Identifier == pinned)
        && (hints is not { Length: > 0 } || hints.Contains(account.Username, StringComparer.OrdinalIgnoreCase));

    internal static LoginPlan PlanLogin(IAccount[] accounts, Request request, OfficeIdentity.Snapshot office,
        Func<WindowsWorkIdentity.Snapshot> readRegistration, LoginDiagnostic diagnostic)
    {
        diagnostic.AvailableAccountCount = accounts.DistinctBy(account => account.HomeAccountId.Identifier).Count();
        diagnostic.TenantAccountCount = accounts.Where(account => string.Equals(account.HomeAccountId.TenantId,
            request.TenantId, StringComparison.OrdinalIgnoreCase)).DistinctBy(account => account.HomeAccountId.Identifier).Count();
        if (!string.IsNullOrEmpty(request.HomeAccountId)) {
            var pinned = SelectAccount(accounts, request.TenantId, request.HomeAccountId);
            return new(pinned, [], "pinned_account", pinned is null ? "account_selection" : null);
        }
        diagnostic.OfficeReadComplete = office.Complete;
        diagnostic.OfficeIdentityCount = office.Identities.Length;
        var selection = OfficeIdentity.Select(office, request.LoginHint);
        if (selection.ErrorCode is { } error) return new(null, [], "office_metadata", error);
        var source = office.Identities.Length > 0 ? "office_metadata" : "saved_dmh_account";
        if (selection.Aliases.Length == 0) {
            var registration = readRegistration();
            diagnostic.WindowsRegistrationReadComplete = registration.Complete;
            diagnostic.WindowsRegistrationCount = registration.Emails.Length;
            if (!registration.Complete) return new(null, [], "windows_registration", "windows_registration_read_failed");
            if (registration.Emails.Length > 0) {
                // A local Windows user can have several WAM accounts and no OS
                // default. Resolve the registered work email against this tenant,
                // then pin the exact broker identity, like the successful preflight.
                var proof = VerifyWorkAccount(accounts, request with { AccountAliases = registration.Emails });
                if (proof.Status != "account_verified") return new(null, [], "windows_registration", proof.ErrorCode);
                var registered = SelectAccount(accounts, request.TenantId, proof.HomeAccountId);
                return new(registered, [proof.VerifiedEmail!], "windows_registration");
            }
            source = "tenant_account";
        }
        var account = SelectAccount(accounts, request.TenantId, null, selection.Aliases);
        var isDefault = ReferenceEquals(account, PublicClientApplication.OperatingSystemAccount);
        var aliases = selection.Aliases.Length > 0 ? selection.Aliases : account is null || isDefault ? [] : new[] { account.Username };
        return new(account, aliases, isDefault ? "windows_default" : source,
            account is null ? "account_selection" : null, AllowWindowsFallback: account is not null && !isDefault);
    }

    internal static async Task<T> RunSilentAttempts<T>(LoginPlan plan, Func<IAccount, Task<T>> acquire, List<SilentAttempt> attempts)
    {
        async Task<T> Try(IAccount account, string kind) {
            try {
                var result = await acquire(account);
                attempts.Add(new(kind, "connected"));
                return result;
            } catch (MsalException error) {
                attempts.Add(new(kind, "failed", SafeError(error),
                    Guid.TryParse(error.CorrelationId, out var correlation) ? correlation.ToString() : null));
                throw;
            } catch (OperationCanceledException) {
                attempts.Add(new(kind, "failed", "timeout"));
                throw;
            } catch (Exception) {
                attempts.Add(new(kind, "failed", "broker_unavailable"));
                throw;
            }
        }
        try { return await Try(plan.Account!, plan.Source); }
        catch (MsalUiRequiredException) when (plan.AllowWindowsFallback) {
            // Keep the FIRST failure too. A failed OS fallback must not erase
            // the reason the selected Microsoft account could not authenticate.
            return await Try(PublicClientApplication.OperatingSystemAccount, "windows_default_fallback");
        }
    }

    // Metadata-only fallback for Office installations that do not publish legacy
    // identity registry entries. This is NOT proof of the active Excel account.
    // Never use OperatingSystemAccount here: a local Windows login is not M365.
    internal static Response VerifyWorkAccount(IAccount[] accounts, Request request)
    {
        const string consumerTenant = "9188040d-6c67-4c5b-b112-36a304b66dad";
        var work = accounts.Where(account => !string.Equals(account.HomeAccountId.TenantId,
            consumerTenant, StringComparison.OrdinalIgnoreCase))
            .DistinctBy(account => account.HomeAccountId.Identifier).ToArray();
        var aliases = OfficeIdentity.Normalize(request.AccountAliases ?? []);
        // Windows can also hold management/support accounts. Resolve the identity
        // already verified by DMH instead of requiring all other accounts absent.
        // Two identities matching the same aliases remain ambiguous unless pinned.
        var matching = work.Where(account => aliases.Length > 0
            && string.Equals(account.HomeAccountId.TenantId, request.TenantId, StringComparison.OrdinalIgnoreCase)
            && IdentityMatches(account, request.HomeAccountId, aliases)).ToArray();
        if (matching.Length != 1) return new("interaction_required", ErrorCode:
            work.Length == 0 ? "windows_work_account_missing"
            : matching.Length > 1 ? "windows_work_account_ambiguous" : "windows_work_account_mismatch",
            WorkAccountCount: work.Length, MatchingAccountCount: matching.Length);
        var account = matching[0];
        return new("account_verified", HomeAccountId: account.HomeAccountId.Identifier, VerifiedEmail: account.Username,
            WorkAccountCount: work.Length, MatchingAccountCount: matching.Length);
    }

    static IPublicClientApplication CreateApplication(Request request) =>
        PublicClientApplicationBuilder.Create(request.ClientId)
            .WithDefaultRedirectUri()
            .WithAuthority(AzureCloudInstance.AzurePublic, request.TenantId)
            .WithBroker(new BrokerOptions(BrokerOptions.OperatingSystems.Windows) {
                Title = "DMH Backup", ListOperatingSystemAccounts = true
            })
            .WithParentActivityOrWindow(() => new IntPtr(request.WindowHandle))
            .Build();

    static async Task<Response> VerifyWindowsAccount(Request request)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var accounts = (await CreateApplication(request).GetAccountsAsync().WaitAsync(timeout.Token)).ToArray();
        return VerifyWorkAccount(accounts, request);
    }

    static async Task<Response> Acquire(Request request)
    {
        var diagnostic = new LoginDiagnostic { ClientId = request.ClientId, TenantId = request.TenantId };
        try {
            var app = CreateApplication(request);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(45));
            var office = string.IsNullOrEmpty(request.HomeAccountId) ? OfficeIdentity.Read() : new OfficeIdentity.Snapshot(true, []);
            if (string.IsNullOrEmpty(request.HomeAccountId)) {
                diagnostic.OfficeReadComplete = office.Complete;
                diagnostic.OfficeIdentityCount = office.Identities.Length;
            }
            diagnostic.Stage = "broker_accounts";
            var accounts = (await app.GetAccountsAsync().WaitAsync(timeout.Token)).ToArray();
            diagnostic.Stage = "account_selection";
            var plan = PlanLogin(accounts, request, office, WindowsWorkIdentity.Read, diagnostic);
            diagnostic.SelectionSource = plan.Source;
            diagnostic.SelectedEmail = plan.Account is null || ReferenceEquals(plan.Account, PublicClientApplication.OperatingSystemAccount)
                ? null : OfficeIdentity.Normalize([plan.Account.Username]).FirstOrDefault();
            if (plan.ErrorCode is { } errorCode) return new("interaction_required", ErrorCode: errorCode, Diagnostic: diagnostic);
            diagnostic.Stage = "silent_acquisition";
            var result = await RunSilentAttempts(plan,
                account => app.AcquireTokenSilent(request.Scopes, account).ExecuteAsync(timeout.Token), diagnostic.Attempts);
            diagnostic.Stage = "identity_verification";
            var pinned = !string.IsNullOrEmpty(request.HomeAccountId) ? request.HomeAccountId
                : plan.Source == "windows_registration" ? plan.Account!.HomeAccountId.Identifier : null;
            if (!IdentityMatches(result.Account, pinned, plan.Aliases))
                return new("interaction_required", ErrorCode: "account_mismatch", Diagnostic: diagnostic);
            diagnostic.Stage = "connected";
            return new("connected", result.AccessToken, result.Account.HomeAccountId.Identifier,
                Math.Max(0, (long)(result.ExpiresOn - DateTimeOffset.UtcNow).TotalSeconds), Diagnostic: diagnostic);
        }
        catch (MsalUiRequiredException error) { return new("interaction_required", ErrorCode: SafeError(error), Diagnostic: diagnostic); }
        catch (MsalException error) { return new(error.ErrorCode == MsalError.AuthenticationCanceledError ? "cancelled" : "unavailable", ErrorCode: SafeError(error), Diagnostic: diagnostic); }
        catch (OperationCanceledException) { return new("unavailable", ErrorCode: "timeout", Diagnostic: diagnostic); }
        catch (Exception) { return new("unavailable", ErrorCode: "broker_unavailable", Diagnostic: diagnostic); }
    }

    internal static string SafeError(MsalException error)
    {
        var aad = Regex.Match(error.Message, @"AADSTS\d+");
        // Only diagnostic codes, never server descriptions or token contents.
        var code = Regex.IsMatch(error.ErrorCode, @"^[a-zA-Z0-9_.-]{1,120}$") ? error.ErrorCode : "broker_error";
        return aad.Success ? $"{code}/{aad.Value}" : code;
    }

    static async Task Main(string[] args)
    {
        if (args is ["--self-test"]) { SelfTests.Run(); return; }
        Response response;
        try
        {
            var line = await Console.In.ReadLineAsync();
            if (line is null || line.Length > 16000) throw new InvalidDataException();
            var request = JsonSerializer.Deserialize<Request>(line, JsonOptions) ?? throw new InvalidDataException();
            if (!OperatingSystem.IsWindows()) response = new("unavailable");
            else if (!Guid.TryParse(request.ClientId, out _) || !Guid.TryParse(request.TenantId, out _) || request.Scopes is not { Length: > 0 })
                response = new("unavailable", ErrorCode: "configuration");
            else response = request.Operation switch {
                null => await Acquire(request),
                "verify_windows_account" => await VerifyWindowsAccount(request),
                _ => new("unavailable", ErrorCode: "operation")
            };
        }
        catch (MsalUiRequiredException error) { response = new("interaction_required", ErrorCode: SafeError(error)); }
        catch (MsalException error) { response = new(error.ErrorCode == MsalError.AuthenticationCanceledError ? "cancelled" : "unavailable", ErrorCode: SafeError(error)); }
        catch (OperationCanceledException) { response = new("unavailable", ErrorCode: "timeout"); }
        catch (Exception) { response = new("unavailable", ErrorCode: "broker_unavailable"); }
        await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, JsonOptions));
    }
}
