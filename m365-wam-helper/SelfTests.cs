using Microsoft.Identity.Client;

internal static class SelfTests
{
    sealed class Account(string id, string tenant, string? username = null) : IAccount
    {
        public string Username => username ?? id + "@example.invalid";
        public string Environment => "login.microsoftonline.com";
        public AccountId HomeAccountId => new(id + "." + tenant, id, tenant);
    }
    public static void Run()
    {
        var first = new Account("first", "tenant");
        var second = new Account("second", "tenant");
        var other = new Account("other", "other-tenant");
        var checks = 0;
        void Check(bool value) { checks++; if (!value) throw new Exception($"WAM account selection test {checks} failed"); }
        Check(ReferenceEquals(Program.SelectAccount([other, first], "tenant", null), first));
        Check(ReferenceEquals(Program.SelectAccount([first, second], "tenant", null), PublicClientApplication.OperatingSystemAccount));
        Check(ReferenceEquals(Program.SelectAccount([other, second, first], "tenant", first.HomeAccountId.Identifier), first));
        Check(Program.SelectAccount([second], "tenant", first.HomeAccountId.Identifier) is null);
        Check(ReferenceEquals(Program.SelectAccount([], "tenant", null), PublicClientApplication.OperatingSystemAccount));
        Check(ReferenceEquals(Program.SelectAccount([first, first], "tenant", first.HomeAccountId.Identifier), first));
        Check(ReferenceEquals(Program.SelectAccount([first, second], "tenant", null, ["second@example.invalid"]), second));
        Check(Program.SafeError(new MsalClientException("safe_code", "secret AADSTS50011 bearer token")) == "safe_code/AADSTS50011");
        Check(Program.SafeError(new MsalClientException("unsafe bearer token", "secret")) == "broker_error");
        Check(ReferenceEquals(Program.SelectAccount([first], "tenant", null, ["second@example.invalid"]), PublicClientApplication.OperatingSystemAccount));
        Check(ReferenceEquals(Program.SelectAccount([other], "tenant", null, ["other@example.invalid"]), other));
        Check(Program.IdentityMatches(second, null, ["SECOND@example.invalid"]));
        Check(!Program.IdentityMatches(first, null, ["second@example.invalid"]));
        Check(!Program.IdentityMatches(second, first.HomeAccountId.Identifier, null));
        Check(!Program.IdentityMatches(null, null, null));
        var verification = new Program.Request("client", "tenant", ["User.Read"], null, 0,
            Operation: "verify_windows_account", AccountAliases: ["second@example.invalid"]);
        var proof = Program.VerifyWorkAccount([second], verification);
        Check(proof.Status == "account_verified" && proof.VerifiedEmail == second.Username && proof.AccessToken is null);
        Check(Program.VerifyWorkAccount([second, second], verification).Status == "account_verified");
        Check(Program.VerifyWorkAccount([], verification).ErrorCode == "windows_work_account_missing");
        Check(Program.VerifyWorkAccount([first, second], verification).Status == "account_verified");
        Check(Program.VerifyWorkAccount([other, second], verification).Status == "account_verified");
        Check(Program.VerifyWorkAccount([first], verification).ErrorCode == "windows_work_account_mismatch");
        Check(Program.VerifyWorkAccount([second], verification with { AccountAliases = [] }).ErrorCode == "windows_work_account_mismatch");
        Check(Program.VerifyWorkAccount([second], verification with { TenantId = "other-tenant" }).ErrorCode == "windows_work_account_mismatch");
        Check(Program.VerifyWorkAccount([second], verification with { HomeAccountId = first.HomeAccountId.Identifier }).ErrorCode == "windows_work_account_mismatch");
        Check(Program.VerifyWorkAccount([second], verification with { HomeAccountId = second.HomeAccountId.Identifier }).Status == "account_verified");
        var personal = new Account("personal", "9188040d-6c67-4c5b-b112-36a304b66dad");
        Check(Program.VerifyWorkAccount([personal, second], verification).Status == "account_verified");
        Check(Program.VerifyWorkAccount([personal], verification).ErrorCode == "windows_work_account_missing");
        var duplicateEmail = new Account("distinct-id", "tenant", second.Username);
        var collision = Program.VerifyWorkAccount([second, duplicateEmail], verification);
        Check(collision.ErrorCode == "windows_work_account_ambiguous" && collision.MatchingAccountCount == 2);
        Check(Program.VerifyWorkAccount([second, duplicateEmail], verification with { HomeAccountId = second.HomeAccountId.Identifier }).Status == "account_verified");
        Check(Program.VerifyWorkAccount([second, duplicateEmail], verification with { HomeAccountId = first.HomeAccountId.Identifier }).ErrorCode == "windows_work_account_mismatch");
        var supportAndUser = Program.VerifyWorkAccount([other, first, second], verification);
        Check(supportAndUser.WorkAccountCount == 3 && supportAndUser.MatchingAccountCount == 1 && supportAndUser.HomeAccountId == second.HomeAccountId.Identifier);
        var wrongTenant = new Account("wrong-tenant-id", "other-tenant", second.Username);
        Check(Program.VerifyWorkAccount([wrongTenant], verification).ErrorCode == "windows_work_account_mismatch");
        Check(Program.VerifyWorkAccount([wrongTenant, second], verification).Status == "account_verified");
        Check(Program.VerifyWorkAccount([first, second], verification with { AccountAliases = [first.Username, second.Username] }).ErrorCode == "windows_work_account_ambiguous");
        OfficeIdentityTests.Run(Check);
        WindowsWorkIdentityTests.Run(Check);
        Console.WriteLine($"{checks} WAM identity/read-failure/redaction checks passed.");
    }
}
