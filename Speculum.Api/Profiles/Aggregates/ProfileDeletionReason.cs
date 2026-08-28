namespace Speculum.Api.Profiles.Aggregates;

/*
    Profile stream — durable identity + Chrome state bucket.

    ProfileCreated
        → (N Sessions linked)
        → ProfileDeleted
*/
public enum ProfileDeletionReason
{
    Unknown,
    UserRequested,
    SessionExpired,
    BudgetEnforced,
}
