// Meta reports an ad's delivery status on the ad itself. An ad in a paused campaign or ad set is not
// "PAUSED" but "CAMPAIGN_PAUSED" / "ADSET_PAUSED", so both groups need the full list.
export const ACTIVE_STATUSES = ["ACTIVE", "WITH_ISSUES", "IN_PROCESS", "PENDING_REVIEW"];
export const PAUSED_STATUSES = ["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"];
