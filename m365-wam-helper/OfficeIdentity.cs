using Microsoft.Win32;
using System.Runtime.Versioning;
using System.Text.RegularExpressions;

// Read identity metadata only, never Office tokens, cookies or credentials.
internal static class OfficeIdentity
{
    internal sealed record Identity(string Key, string[] Aliases);
    internal sealed record Snapshot(bool Complete, Identity[] Identities);
    internal sealed record Selection(string[] Aliases, string? ErrorCode = null);

    internal interface IKey : IDisposable
    {
        string? ReadString(string name);
        string[] SubKeyNames();
        IKey? Open(string name);
    }

    [SupportedOSPlatform("windows")]
    sealed class WindowsKey(RegistryKey key) : IKey
    {
        public string? ReadString(string name) => key.GetValue(name) switch {
            null => null,
            string value => value,
            _ => throw new IOException("Unexpected identity metadata type")
        };
        public string[] SubKeyNames() => key.GetSubKeyNames();
        public IKey? Open(string name) => key.OpenSubKey(name) is { } child ? new WindowsKey(child) : null;
        public void Dispose() => key.Dispose();
    }

    internal static string[] Normalize(IEnumerable<string?> values) => values
        .Select(value => value?.Trim() ?? "")
        .Where(value => value.Length <= 254 && Regex.IsMatch(value, @"^[^\s@]+@[^\s@]+$"))
        .Distinct(StringComparer.OrdinalIgnoreCase).ToArray();

    [SupportedOSPlatform("windows")]
    static IKey? OpenWindowsVersion(string version) =>
        Registry.CurrentUser.OpenSubKey($@"Software\Microsoft\Office\{version}\Common\Identity")
            is { } root ? new WindowsKey(root) : null;

    internal static Snapshot Read() => OperatingSystem.IsWindows()
        ? Read(OpenWindowsVersion)
        : new(false, []);

    internal static Snapshot Read(Func<string, IKey?> openVersion)
    {
        var complete = true;
        var identities = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        var preferred = new List<string?>();
        foreach (var version in new[] { "16.0", "15.0" }) {
            try {
                using var root = openVersion(version);
                if (root is null) continue; // A genuinely missing Office version is not a read failure.
                preferred.Add(root.ReadString("ADUserName"));
                using var entries = root.Open("Identities");
                if (entries is null) continue;
                var names = entries.SubKeyNames();
                if (names.Length > 64) { complete = false; continue; }
                foreach (var name in names) {
                    using var entry = entries.Open(name);
                    if (entry is null) { complete = false; continue; } // Disappeared during enumeration.
                    var aliases = Normalize(new[] {
                        entry.ReadString("EmailAddress"), entry.ReadString("PreferredUsername"), entry.ReadString("SigninName")
                    });
                    if (aliases.Length == 0) continue;
                    // Fields in ONE Office identity are aliases, not independent accounts.
                    // Only an identical identity key can combine entries across Office versions.
                    if (!identities.TryGetValue(name, out var group))
                        identities[name] = group = new(StringComparer.OrdinalIgnoreCase);
                    group.UnionWith(aliases);
                }
            } catch (Exception error) when (error is System.Security.SecurityException or UnauthorizedAccessException or IOException) {
                complete = false;
            }
        }
        var result = identities.Select(pair => new Identity(pair.Key, pair.Value.ToArray())).ToList();
        foreach (var email in Normalize(preferred)) {
            if (!result.Any(identity => identity.Aliases.Contains(email, StringComparer.OrdinalIgnoreCase)))
                result.Add(new("preferred:" + email, [email]));
        }
        return new(complete, result.ToArray());
    }

    internal static Selection Select(Snapshot snapshot, string? requested)
    {
        // Never authenticate based on a partial read, even if one valid account was read first.
        if (!snapshot.Complete) return new([], "office_identity_read_failed");
        var groups = snapshot.Identities.Select(identity => Normalize(identity.Aliases)).Where(aliases => aliases.Length > 0).ToArray();
        if (groups.Length == 0) return new(Normalize([requested]));
        if (groups.Length == 1) return new(groups[0]);
        var matching = groups.Where(aliases => aliases.Contains(requested?.Trim() ?? "", StringComparer.OrdinalIgnoreCase)).ToArray();
        return matching.Length == 1 ? new(matching[0]) : new([], "office_account_ambiguous");
    }
}
