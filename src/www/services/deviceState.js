/**
 * Device State — direct port of shared/device_state.py.
 * Single in-memory object, no polling — caller updates it (e.g. from
 * a native battery-status plugin) via updateState().
 */

let _state = {
  battery: { level: 100, charging: false, critical: false },
  time: { hour: 0, period: 'night', quiet_hours: false },
  activity: 'idle',
};

function periodForHour(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function refreshTime(now = null) {
  now = now || new Date();
  const hour = now.getHours();
  _state.time = {
    hour,
    period: periodForHour(hour),
    quiet_hours: hour >= 23 || hour < 6,
  };
}

/** Shallow-merges a patch into state. */
export function updateState(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === 'object' && value !== null && typeof _state[key] === 'object' && _state[key] !== null) {
      _state[key] = { ..._state[key], ...value };
    } else {
      _state[key] = value;
    }
  }
}

export function getState() {
  return _state;
}
