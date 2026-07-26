using System.Text.Json;
using Speculum.Api.Profiles.Aggregates;
using Speculum.Api.Profiles.Responses;
using Speculum.Api.Sessions.Models;

namespace Speculum.Api.Profiles.Storage;

internal static class ProfileMapper
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static Profile ToDomain(ProfileRecord record)
    {
        var snapshot = JsonSerializer.Deserialize<ProfileStateSnapshot>(record.StateJson, JsonOptions)
            ?? new ProfileStateSnapshot();
        return Profile.Reconstitute(record.Id, snapshot.ToProfileState());
    }

    public static ProfileRecord ToRecord(Profile profile, DateTimeOffset now)
        => new()
        {
            Id = profile.Id,
            StateJson = JsonSerializer.Serialize(ProfileStateSnapshot.From(profile.State), JsonOptions),
            CreatedAt = now,
            UpdatedAt = now,
        };

    public static ProfileListItem ToListItem(ProfileRecord record)
        => new()
        {
            ProfileId = record.Id,
            CreatedAt = record.CreatedAt,
            UpdatedAt = record.UpdatedAt,
        };

    public static ProfileSummary ToSummary(ProfileRecord record)
    {
        var snapshot = JsonSerializer.Deserialize<ProfileStateSnapshot>(record.StateJson, JsonOptions)
            ?? new ProfileStateSnapshot();

        return new ProfileSummary
        {
            ProfileId = record.Id,
            CreatedAt = record.CreatedAt,
            UpdatedAt = record.UpdatedAt,
            CookieCount = snapshot.Cookies.Count,
            LocalStorageCount = snapshot.LocalStorage.Count,
            IdbRecordCount = snapshot.IdbRecords.Count,
            HistoryCount = snapshot.History.Count,
        };
    }

    private sealed class ProfileStateSnapshot
    {
        public List<BrowserCookieState> Cookies { get; set; } = [];
        public List<BrowserLocalStorageState> LocalStorage { get; set; } = [];
        public List<BrowserIdbRecordState> IdbRecords { get; set; } = [];
        public List<BrowserHistoryState> History { get; set; } = [];

        public static ProfileStateSnapshot From(ProfileState state)
            => new()
            {
                Cookies = state.Cookies.ToList(),
                LocalStorage = state.LocalStorage.ToList(),
                IdbRecords = state.IdbRecords.ToList(),
                History = state.History.ToList(),
            };

        public ProfileState ToProfileState()
        {
            var state = new ProfileState();
            state.Cookies.AddRange(Cookies);
            state.LocalStorage.AddRange(LocalStorage);
            state.IdbRecords.AddRange(IdbRecords);
            state.History.AddRange(History);
            return state;
        }
    }
}
