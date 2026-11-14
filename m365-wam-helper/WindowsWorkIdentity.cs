using Microsoft.Win32;
using System.Runtime.Versioning;

// Current-user registration metadata only. This is a login hint, not proof of
// the active Excel account or permission to use an account from another tenant.
internal static class WindowsWorkIdentity
{
    internal sealed record Snapshot(bool Complete, string[] Emails);
    internal const string RegistryPath = @"Software\Microsoft\Windows NT\CurrentVersion\WorkplaceJoin\JoinInfo";

    [SupportedOSPlatform("windows")]
    sealed class Key(RegistryKey key) : OfficeIdentity.IKey
    {
        public string? ReadString(string name) => key.GetValue(name) switch {
            null => null, string value => value, _ => throw new IOException("Unexpected registration metadata type")
        };
        public string[] SubKeyNames() => key.GetSubKeyNames();
        public OfficeIdentity.IKey? Open(string name) => key.OpenSubKey(name) is { } child ? new Key(child) : null;
        public void Dispose() => key.Dispose();
    }

    [SupportedOSPlatform("windows")]
    static OfficeIdentity.IKey? Open(RegistryView view)
    {
        using var user = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view);
        return user.OpenSubKey(RegistryPath) is { } root ? new Key(root) : null;
    }

    internal static Snapshot Read() => OperatingSystem.IsWindows() ? Read(Open) : new(false, []);

    internal static Snapshot Read(Func<RegistryView, OfficeIdentity.IKey?> open)
    {
        var emails = new List<string?>();
        var complete = true;
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 }) {
            try {
                using var root = open(view);
                if (root is null) continue;
                var names = root.SubKeyNames();
                if (names.Length > 64) { complete = false; continue; }
                foreach (var name in names) {
                    using var entry = root.Open(name);
                    if (entry is null) { complete = false; continue; }
                    var email = entry.ReadString("UserEmail");
                    if (email is not null && OfficeIdentity.Normalize([email]).Length == 0) {
                        complete = false;
                        continue;
                    }
                    emails.Add(email);
                }
            } catch (Exception error) when (error is System.Security.SecurityException or UnauthorizedAccessException or IOException) {
                complete = false;
            }
        }
        return new(complete, OfficeIdentity.Normalize(emails));
    }
}
