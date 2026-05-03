"""
INTEGRATION GUIDE: Power Flow Component with Flask Backend (v1.0)

This file demonstrates how to integrate the Power Flow Animation Component
with a Flask battery monitoring application, utilizing the full telemetry suite.
"""

# ============================================================================
# FLASK INTEGRATION EXAMPLE
# ============================================================================

from flask import Flask, jsonify, render_template
import psutil
import time
from datetime import datetime

app = Flask(__name__, static_folder='static')

# ============================================================================
# 1. API ENDPOINT FOR REAL-TIME BATTERY DATA
# ============================================================================

@app.route('/api/battery-status')
def get_battery_status():
    """
    Return current battery status with full telemetry for the Power Flow Component.
    """
    try:
        battery = psutil.sensors_battery()
        
        if battery is None:
            return jsonify({'error': 'No battery detected'})
        
        # Simulated or real metrics
        # Note: psutil doesn't provide voltage/amperage on all platforms.
        # In a real app, you might use platform-specific tools like `ioreg` (macOS)
        # or `upower` (Linux).
        
        status = {
            'isPluggedIn': battery.power_plugged,
            'batteryLevel': int(battery.percent),
            'isCharging': battery.power_plugged and battery.percent < 100,
            'timeRemainingMin': battery.secsleft // 60 if battery.secsleft > 0 else None,
            
            # Advanced Telemetry (Simulated if not available from psutil)
            'voltageMv': 12240,       # 12.24V
            'amperageMa': 2450 if battery.power_plugged else -1200,
            'temperatureC': 34.5,
            'cycleCount': 128,
            'systemPowerW': 18.5,
            'adapterWatts': 96 if battery.power_plugged else 0,
            
            'sampledAt': datetime.now().isoformat()
        }
        
        return jsonify(status)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# 2. EXAMPLE DASHBOARD HTML (Simplified for this guide)
# ============================================================================

"""
Place this in your dashboard template:

<div id="viz-container"></div>

<script src="/static/power-flow/power-flow-component.js"></script>
<script>
    const viz = new PowerFlowComponent('viz-container', {
        batteryLevel: 0,
        isPluggedIn: false
    });

    async function poll() {
        try {
            const res = await fetch('/api/battery-status');
            const data = await res.json();
            if (!data.error) {
                viz.setState(data);
            }
        } catch (e) {
            console.error("Polling failed", e);
        }
    }

    setInterval(poll, 1000);
    poll();
</script>
"""

if __name__ == '__main__':
    app.run(debug=True)
