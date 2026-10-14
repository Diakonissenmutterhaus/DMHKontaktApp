using Microsoft.Identity.Client;

internal static class SelfTests
{
    sealed class Account(string id, string tenant) : IAccount
    {
        public string Username => id + "@example.invalid";
        public string Environment => "login.microsoftonline.com";
        public AccountId HomeAccountId => new(id + "." + tenant, id, tenant);
    }
    public static void Run()
    {
        var first = new Account("first", "tenant");
        var second = new Account("second", "tenant");
        var other = new Account("other", "other-tenant");
        void Check(bool value) { if (!value) throw new Exception("WAM account selection test failed"); }
        Check(ReferenceEquals(Program.SelectAccount([other, first], "tenant", null), first));
        Check(ReferenceEquals(Program.SelectAccount([first, second], "tenant", null), PublicClientApplication.OperatingSystemAccount));
        Check(ReferenceEquals(Program.SelectAccount([other, second, first], "tenant", first.HomeAccountId.Identifier), first));
        Check(Program.SelectAccount([second], "tenant", first.HomeAccountId.Identifier) is null);
        Check(ReferenceEquals(Program.SelectAccount([], "tenant", null), PublicClientApplication.OperatingSystemAccount));
        Check(ReferenceEquals(Program.SelectAccount([first, first], "tenant", first.HomeAccountId.Identifier), first));
        Check(ReferenceEquals(Program.SelectAccount([first, second], "tenant", null, "second@example.invalid"), second));
        Check(Program.SafeError(new MsalClientException("safe_code", "secret AADSTS50011 bearer token")) == "safe_code/AADSTS50011");
        Check(Program.SafeError(new MsalClientException("unsafe bearer token", "secret")) == "broker_error");
        Console.WriteLine("9 WAM account selection/redaction checks passed.");
    }
}
