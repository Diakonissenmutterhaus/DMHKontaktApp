using Microsoft.Identity.Client;
using Microsoft.Win32;
using System.Text.Json;

internal static class WindowsWorkIdentityTests
{
    sealed class Account(string email, string id, string tenant = "tenant") : IAccount
    {
        public string Username => email;
        public string Environment => "login.microsoftonline.com";
        public AccountId HomeAccountId => new(id + "." + tenant, id, tenant);
    }
    sealed class Key : OfficeIdentity.IKey
    {
        internal string? Email;
        internal Dictionary<string, OfficeIdentity.IKey?> Children = [];
        public string? ReadString(string name) => name == "UserEmail" ? Email : throw new Exception("Unexpected metadata field");
        public string[] SubKeyNames() => Children.Keys.ToArray();
        public OfficeIdentity.IKey? Open(string name) => Children.GetValueOrDefault(name);
        public void Dispose() { }
    }
    internal static void Run(Action<bool> check)
    {
        var user = new Account("user@example.test", "user");
        var support = new Account("support@example.test", "support");
        var external = new Account("user@example.test", "external", "another-tenant");
        var emptyOffice = new OfficeIdentity.Snapshot(true, []);
        var request = new Program.Request("client", "tenant", ["User.Read"], null, 0);
        var registration = new WindowsWorkIdentity.Snapshot(true, [user.Username]);
        var diagnostic = new Program.LoginDiagnostic();
        // Reproduce the affected PC: Office metadata empty, local Windows user,
        // several broker accounts, no OS default. The old path chose OS default.
        check(ReferenceEquals(Program.SelectAccount([support, user], "tenant", null), PublicClientApplication.OperatingSystemAccount));
        var plan = Program.PlanLogin([support, external, user], request, emptyOffice, () => registration, diagnostic);
        check(ReferenceEquals(plan.Account, user) && plan.Source == "windows_registration" && plan.ErrorCode is null);
        check(!plan.AllowWindowsFallback && plan.Aliases.SequenceEqual([user.Username]));
        check(diagnostic.OfficeIdentityCount == 0 && diagnostic.AvailableAccountCount == 3 && diagnostic.TenantAccountCount == 2);
        check(diagnostic.WindowsRegistrationCount == 1 && diagnostic.WindowsRegistrationReadComplete == true);
        check(Program.PlanLogin([support, external], request, emptyOffice, () => registration, new()).ErrorCode == "windows_work_account_mismatch");
        var collision = new Account(user.Username, "other-id");
        check(Program.PlanLogin([user, collision], request, emptyOffice, () => registration, new()).ErrorCode == "windows_work_account_ambiguous");
        check(Program.PlanLogin([user, support], request, emptyOffice,
            () => new(true, [user.Username, support.Username]), new()).ErrorCode == "windows_work_account_ambiguous");
        check(Program.PlanLogin([user], request, emptyOffice, () => new(false, [user.Username]), new()).ErrorCode == "windows_registration_read_failed");
        check(Program.PlanLogin([user], request, new(false, []), () => throw new Exception("Partial Office read must stop"), new()).ErrorCode == "office_identity_read_failed");
        var office = new OfficeIdentity.Snapshot(true, [new("office", [user.Username])]);
        check(ReferenceEquals(Program.PlanLogin([user, support], request, office,
            () => throw new Exception("Office account takes precedence"), new()).Account, user));
        check(ReferenceEquals(Program.PlanLogin([user, support], request with { LoginHint = user.Username }, emptyOffice,
            () => throw new Exception("Known DMH account takes precedence"), new()).Account, user));
        check(Program.PlanLogin([support], request with { HomeAccountId = user.HomeAccountId.Identifier }, emptyOffice,
            () => throw new Exception("Renewal cannot switch accounts"), new()).ErrorCode == "account_selection");
        check(ReferenceEquals(Program.PlanLogin([user], request, emptyOffice, () => new(true, []), new()).Account, user));
        check(ReferenceEquals(Program.PlanLogin([], request, emptyOffice, () => new(true, []), new()).Account, PublicClientApplication.OperatingSystemAccount));

        var root = new Key { Children = { ["registered"] = new Key { Email = " USER@example.test " } } };
        var read = WindowsWorkIdentity.Read(_ => root);
        check(read.Complete && read.Emails.Length == 1 && read.Emails[0] == "USER@example.test");
        check(WindowsWorkIdentity.Read(view => view == RegistryView.Registry32 ? root : null).Emails.Length == 1);
        check(WindowsWorkIdentity.Read(_ => null).Complete && WindowsWorkIdentity.Read(_ => null).Emails.Length == 0);
        check(!WindowsWorkIdentity.Read(view => view == RegistryView.Registry32 ? throw new UnauthorizedAccessException() : root).Complete);
        check(!WindowsWorkIdentity.Read(_ => new Key { Children = { ["gone"] = null } }).Complete);
        check(!WindowsWorkIdentity.Read(_ => new Key { Children = { ["invalid"] = new Key { Email = "not-an-email" } } }).Complete);
        var oversized = new Key();
        for (var i = 0; i < 65; i++) oversized.Children[i.ToString()] = new Key { Email = user.Username };
        check(!WindowsWorkIdentity.Read(_ => oversized).Complete);

        var attempts = new List<Program.SilentAttempt>();
        var calls = 0;
        var silentResult = Program.RunSilentAttempts(plan, account => {
            calls++;
            check(ReferenceEquals(account, user));
            return Task.FromResult("verified");
        }, attempts).GetAwaiter().GetResult();
        check(silentResult == "verified" && calls == 1 && attempts.Count == 1);
        attempts.Clear(); calls = 0;
        try {
            Program.RunSilentAttempts<string>(plan, _ => {
                calls++;
                throw new MsalUiRequiredException("consent_required", "private text AADSTS65001");
            }, attempts).GetAwaiter().GetResult();
            check(false);
        } catch (MsalUiRequiredException) {
            check(calls == 1 && attempts.Single().ErrorCode == "consent_required/AADSTS65001");
        }
        attempts.Clear(); calls = 0;
        var legacyPlan = new Program.LoginPlan(user, [user.Username], "office_metadata", AllowWindowsFallback: true);
        try {
            Program.RunSilentAttempts<string>(legacyPlan, account => {
                calls++;
                throw ReferenceEquals(account, user)
                    ? new MsalUiRequiredException("consent_required", "private text AADSTS65001")
                    : new MsalUiRequiredException("failed_to_acquire_token_silently_from_broker", "private fallback text");
            }, attempts).GetAwaiter().GetResult();
            check(false);
        } catch (MsalUiRequiredException) {
            check(calls == 2 && attempts.Count == 2);
            check(attempts[0].ErrorCode == "consent_required/AADSTS65001" && attempts[1].Kind == "windows_default_fallback");
            check(!JsonSerializer.Serialize(attempts).Contains("private"));
        }
    }
}
