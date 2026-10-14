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
        string? HomeAccountId, long WindowHandle, string? LoginHint = null, bool AllowInteractive = false);
    internal sealed record Response(string Status, string? AccessToken = null,
        string? HomeAccountId = null, long ExpiresIn = 0, string? ErrorCode = null);
    static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, PropertyNameCaseInsensitive = true };

    // Never choose the first account from a list. Renewal is pinned to the
    // original account; ambiguity uses only Windows' own default identity.
    internal static IAccount? SelectAccount(IAccount[] accounts, string tenantId, string? homeAccountId, string? loginHint = null)
    {
        var unique = accounts.DistinctBy(account => account.HomeAccountId.Identifier).ToArray();
        if (!string.IsNullOrEmpty(homeAccountId))
            return unique.SingleOrDefault(account => account.HomeAccountId.Identifier == homeAccountId);
        var matching = unique.Where(account => string.Equals(account.HomeAccountId.TenantId, tenantId, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (!string.IsNullOrEmpty(loginHint)) {
            var known = matching.Where(account => account.Username.Equals(loginHint, StringComparison.OrdinalIgnoreCase)).ToArray();
            if (known.Length == 1) return known[0];
        }
        return matching.Length == 1 ? matching[0] : PublicClientApplication.OperatingSystemAccount;
    }

    static async Task<Response> Acquire(Request request)
    {
        if (!OperatingSystem.IsWindows()) return new("unavailable");
        if (!Guid.TryParse(request.ClientId, out _) || !Guid.TryParse(request.TenantId, out _) || request.Scopes.Length == 0)
            return new("unavailable", ErrorCode: "configuration");
        var app = PublicClientApplicationBuilder.Create(request.ClientId)
            .WithDefaultRedirectUri()
            .WithAuthority(AzureCloudInstance.AzurePublic, request.TenantId)
            .WithBroker(new BrokerOptions(BrokerOptions.OperatingSystems.Windows) {
                Title = "DMH Backup", ListOperatingSystemAccounts = true
            })
            .WithParentActivityOrWindow(() => new IntPtr(request.WindowHandle))
            .Build();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(request.AllowInteractive ? 240 : 45));
        var accounts = (await app.GetAccountsAsync().WaitAsync(timeout.Token)).ToArray();
        var account = SelectAccount(accounts, request.TenantId, request.HomeAccountId, request.LoginHint);
        if (account is null) return new("interaction_required", ErrorCode: "account_selection");
        AuthenticationResult result;
        try { result = await app.AcquireTokenSilent(request.Scopes, account).ExecuteAsync(timeout.Token); }
        catch (MsalUiRequiredException) when (request.AllowInteractive && request.WindowHandle != 0 && string.IsNullOrEmpty(request.HomeAccountId)) {
            // Only an explicit Connect click permits Microsoft's account
            // selection / policy confirmation. Never during renewal.
            var interactive = app.AcquireTokenInteractive(request.Scopes);
            if (ReferenceEquals(account, PublicClientApplication.OperatingSystemAccount))
                interactive = interactive.WithPrompt(Prompt.SelectAccount);
            else interactive = interactive.WithAccount(account);
            result = await interactive.ExecuteAsync(timeout.Token);
        }
        if (result.Account is null || string.IsNullOrEmpty(result.Account.HomeAccountId.Identifier)
            || (!string.IsNullOrEmpty(request.HomeAccountId) && result.Account.HomeAccountId.Identifier != request.HomeAccountId))
            return new("interaction_required", ErrorCode: "account_mismatch");
        return new("connected", result.AccessToken, result.Account.HomeAccountId.Identifier,
            Math.Max(0, (long)(result.ExpiresOn - DateTimeOffset.UtcNow).TotalSeconds));
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
            response = await Acquire(request);
        }
        catch (MsalUiRequiredException error) { response = new("interaction_required", ErrorCode: SafeError(error)); }
        catch (MsalException error) { response = new(error.ErrorCode == MsalError.AuthenticationCanceledError ? "cancelled" : "unavailable", ErrorCode: SafeError(error)); }
        catch (OperationCanceledException) { response = new("unavailable", ErrorCode: "timeout"); }
        catch (Exception) { response = new("unavailable", ErrorCode: "broker_unavailable"); }
        await Console.Out.WriteLineAsync(JsonSerializer.Serialize(response, JsonOptions));
    }
}
