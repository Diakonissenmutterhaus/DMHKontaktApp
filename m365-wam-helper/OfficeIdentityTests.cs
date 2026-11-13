using Microsoft.Identity.Client;

internal static class OfficeIdentityTests
{
    // Faults are injected into the real reader, not into an already-built result.
    sealed class Key : OfficeIdentity.IKey
    {
        internal Dictionary<string, string?> Values = [];
        internal Dictionary<string, OfficeIdentity.IKey?> Children = [];
        internal Func<string, Exception?>? ReadFault;
        internal Exception? EnumerationFault;
        public string? ReadString(string name) {
            if (name is not ("ADUserName" or "EmailAddress" or "PreferredUsername" or "SigninName"))
                throw new Exception("Reader requested non-identity data");
            if (ReadFault?.Invoke(name) is { } error) throw error;
            return Values.GetValueOrDefault(name);
        }
        public string[] SubKeyNames() {
            if (EnumerationFault is { } error) throw error;
            return Children.Keys.ToArray();
        }
        public OfficeIdentity.IKey? Open(string name) => Children.GetValueOrDefault(name);
        public void Dispose() { }
    }
    sealed class Account(string username, string id) : IAccount
    {
        public string Username => username;
        public string Environment => "login.microsoftonline.com";
        public AccountId HomeAccountId => new(id + ".tenant", id, "tenant");
    }
    static Key Root(Key entries, string? preferred = null) => new() {
        Values = { ["ADUserName"] = preferred }, Children = { ["Identities"] = entries }
    };
    static OfficeIdentity.Snapshot Read(Key root) => OfficeIdentity.Read(version => version == "16.0" ? root : null);

    internal static void Run(Action<bool> check)
    {
        var identity = new Key { Values = {
            ["EmailAddress"] = " Anna@example.test ",
            ["PreferredUsername"] = "anna@tenant.onmicrosoft.com",
            ["SigninName"] = "ANNA@example.test"
        }};
        var root = Root(new Key { Children = { ["identity-anna"] = identity } }, "anna@example.test");
        var snapshot = Read(root);
        var selected = OfficeIdentity.Select(snapshot, null);
        check(snapshot.Complete && snapshot.Identities.Length == 1);
        check(selected.ErrorCode is null && selected.Aliases.Length == 2);
        var account = new Account("anna@tenant.onmicrosoft.com", "anna");
        var wrong = new Account("admin@example.test", "admin");
        check(ReferenceEquals(Program.SelectAccount([wrong, account], "tenant", null, selected.Aliases), account));
        check(Program.IdentityMatches(account, null, selected.Aliases));
        check(!Program.IdentityMatches(wrong, null, selected.Aliases));
        check(Program.IdentityMatches(account, account.HomeAccountId.Identifier, []));
        check(!Program.IdentityMatches(wrong, account.HomeAccountId.Identifier, []));
        check(ReferenceEquals(Program.SelectAccount([], "tenant", null, selected.Aliases), PublicClientApplication.OperatingSystemAccount));
        // A different broker identity using another listed alias is a genuine conflict.
        check(Program.SelectAccount([account, new Account("Anna@example.test", "another")], "tenant", null, selected.Aliases) is null);
        // The same identity recorded by two Office versions remains a single identity.
        check(OfficeIdentity.Read(_ => root).Identities.Length == 1);

        var second = new Key { Values = { ["EmailAddress"] = "admin@example.test" } };
        var multiple = Read(Root(new Key { Children = { ["anna"] = identity, ["admin"] = second } }));
        check(multiple.Identities.Length == 2);
        check(OfficeIdentity.Select(multiple, null).ErrorCode == "office_account_ambiguous");
        check(OfficeIdentity.Select(multiple, " ANNA@example.test ").Aliases.Length == 2);
        // Overlapping addresses alone cannot collapse distinct identities.
        var overlap = Read(Root(new Key { Children = { ["one"] = identity, ["two"] = identity } }));
        check(OfficeIdentity.Select(overlap, "anna@example.test").ErrorCode == "office_account_ambiguous");
        check(OfficeIdentity.Select(snapshot, "old@example.test").Aliases.Length == 2);
        check(Read(Root(new Key(), "anna@example.test")).Identities.Length == 1);

        var empty = OfficeIdentity.Read(_ => null);
        check(empty.Complete && empty.Identities.Length == 0);
        check(OfficeIdentity.Select(empty, null).ErrorCode is null);
        check(OfficeIdentity.Select(empty, "anna@example.test").Aliases.SequenceEqual(["anna@example.test"]));
        check(OfficeIdentity.Normalize([null, "", "bad", "  ANNA@example.test ", "anna@example.test"]).Length == 1);

        foreach (var failure in new Exception[] {
            new UnauthorizedAccessException(), new System.Security.SecurityException(), new IOException()
        }) {
            var partial = OfficeIdentity.Read(version => version == "16.0" ? root : throw failure);
            check(!partial.Complete && partial.Identities.Length == 1);
            var rejected = OfficeIdentity.Select(partial, "anna@example.test");
            check(rejected.ErrorCode == "office_identity_read_failed" && rejected.Aliases.Length == 0);
            check(!OfficeIdentity.Read(_ => throw failure).Complete);
        }
        // Failure after reading the first field cannot accept a truncated alias set.
        var brokenEntry = new Key { Values = { ["EmailAddress"] = "anna@example.test" },
            ReadFault = field => field == "PreferredUsername" ? new IOException() : null };
        var partialEntry = Read(Root(new Key { Children = { ["anna"] = brokenEntry } }));
        check(!partialEntry.Complete);
        check(OfficeIdentity.Select(partialEntry, null).ErrorCode == "office_identity_read_failed");
        check(!Read(Root(new Key { EnumerationFault = new UnauthorizedAccessException() })).Complete);
        check(!Read(Root(new Key { Children = { ["disappeared"] = null } })).Complete);
        var tooMany = new Key();
        for (var i = 0; i < 65; i++) tooMany.Children[i.ToString()] = identity;
        check(!Read(Root(tooMany)).Complete);
    }
}
