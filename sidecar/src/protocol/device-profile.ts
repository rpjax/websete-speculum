export type DeviceProfile = {
    mobile: boolean;
    touch: boolean;
    deviceScaleFactor: number;
    maxTouchPoints: number;
    userAgentProfile?: string;
    screenOrientation?: string;
};

export const DEFAULT_DEVICE_PROFILE: DeviceProfile = {
    mobile: false,
    touch: false,
    deviceScaleFactor: 1,
    maxTouchPoints: 0,
    userAgentProfile: 'desktop',
};

const MAX_DPR = 2;
const MAX_TOUCH_POINTS = 10;

export function normalizeDeviceProfile(raw: Partial<DeviceProfile> | undefined | null): DeviceProfile {
    if (!raw) return { ...DEFAULT_DEVICE_PROFILE };

    let dpr = Number(raw.deviceScaleFactor);
    if (!Number.isFinite(dpr) || dpr <= 0) dpr = 1;
    dpr = Math.min(MAX_DPR, Math.max(1, dpr));

    let maxTouchPoints = Number(raw.maxTouchPoints) || 0;
    if (maxTouchPoints < 0) maxTouchPoints = 0;
    if (maxTouchPoints > MAX_TOUCH_POINTS) maxTouchPoints = MAX_TOUCH_POINTS;

    const mobile = !!raw.mobile;
    let touch = !!raw.touch || mobile;
    if (touch && maxTouchPoints === 0) maxTouchPoints = 5;

    let userAgentProfile = raw.userAgentProfile;
    if (userAgentProfile !== 'mobile' && userAgentProfile !== 'desktop') {
        userAgentProfile = mobile ? 'mobile' : 'desktop';
    }

    return {
        mobile,
        touch,
        deviceScaleFactor: dpr,
        maxTouchPoints,
        userAgentProfile,
        screenOrientation: raw.screenOrientation,
    };
}
