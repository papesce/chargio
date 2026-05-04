# Power Flow Animation Component (v1.0)

A high-performance, data-driven SVG visualization system designed for real-time battery monitoring dashboards. It visualizes energy dynamics between power sources (AC/Battery) and systems (Laptop) with surgical precision.

## 🚀 Core Features

- **Advanced Telemetry**: Supports voltage, amperage, wattage, capacity, and temperature.
- **Dynamic SVG Engine**: Pure JavaScript + SVG/CSS animations (no heavy canvas).
- **Intelligent Flow Logic**: Visualizes bidirectional energy paths based on system state.
- **Responsive & Lightweight**: Adapts to any container size; ~20KB uncompressed.
- **Framework Agnostic**: Native JS class works with React, Vue, Angular, or Vanilla JS.

---

## 🛠️ API Reference

### Constructor
```javascript
const component = new PowerFlowComponent(containerId, initialState);
```

### Full State Model
The component state supports a rich set of telemetry data:

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `isPluggedIn` | boolean | `false` | Connected to wall power |
| `isCharging` | boolean | `false` | Battery is actively receiving charge |
| `batteryLevel` | number | `75` | Charge percentage (0-100) |
| `powerFlowIntensity` | number | `1.0` | Animation speed multiplier (0.2 - 2.0) |
| `amperageMa` | number | `null` | Battery current in mA (+ is in, - is out) |
| `voltageMv` | number | `null` | Battery voltage in millivolts |
| `powerW` | number | `null` | Battery power in Watts |
| `systemPowerW` | number | `null` | Total system power consumption (W) |
| `adapterWatts` | number | `null` | Power capacity of connected charger (W) |
| `temperatureC` | number | `null` | Battery temperature in Celsius |
| `cycleCount` | number | `null` | Total discharge/recharge cycles |
| `timeRemainingMin` | number | `null` | Estimated minutes until empty/full |

### Methods

#### `setState(newState)`
Updates the component with partial or full state. Triggers visual refresh.
```javascript
component.setState({
  batteryLevel: 42,
  isPluggedIn: true,
  isCharging: true,
  amperageMa: 4500 // Charging at 4.5A
});
```

#### `getState()`
Returns a clone of the current state.

#### `destroy()`
Cleans up DOM and removes the SVG.

---

## 🎨 Visual Intelligence

### 1. Energy Flow Paths
- **Yellow Flow**: Battery is discharging (powering the laptop). Speed and thickness scale with discharge magnitude (`amperageMa < 0`).
- **Blue Flow**: Adapter is powering the laptop. Speed and thickness scale with `powerFlowIntensity`.
- **Green Flow**: Adapter/Laptop is charging the battery. Speed and thickness scale with charge rate (`amperageMa > 0`).

### 2. Battery Representation
- **Dynamic Text Color**: The percentage readout (e.g., "75%") matches the active flow color: **Yellow** (Discharge), **Green** (Charge), or **White** (Idle).
- **Voltage Display**: Real-time battery voltage is displayed in a themed "pill" in the top-right corner.
- **Battery Ring Colors**:
    - **Red (Critical)**: level ≤ 20%
    - **Yellow (Warning)**: level ≤ 55% OR (Plugged in and level < 99% but NOT charging)
    - **Green (Healthy)**: level > 55%
- **Temperature Cell**: A dedicated slate-blue pill at the bottom shows the current temperature.

### 3. Metric Cards
The component automatically calculates and displays cards for:
- **Power Source**: Current input wattage and adapter info.
- **Battery Flow**: Net current (mA) entering or leaving the cells.
- **Battery Health**: Current temperature and cycle count.
- **Remaining**: Time remaining estimate.

---

## 💻 Integration Guide

### Vanilla JavaScript
```javascript
const component = new PowerFlowComponent('viz-container', {
    batteryLevel: 80,
    isPluggedIn: true
});

// Update from your data source
function onUpdate(data) {
    component.setState({
        batteryLevel: data.percentage,
        amperageMa: data.current_ma,
        isCharging: data.is_charging
    });
}
```

### React Hooks Integration
```jsx
import { useEffect, useRef } from 'react';
import PowerFlowComponent from './power-flow-component';

export function PowerFlowViz({ data }) {
    const containerRef = useRef(null);
    const vizRef = useRef(null);

    useEffect(() => {
        vizRef.current = new PowerFlowComponent(containerRef.current.id, data);
        return () => vizRef.current.destroy();
    }, []);

    useEffect(() => {
        vizRef.current?.setState(data);
    }, [data]);

    return <div id="power-viz" ref={containerRef} style={{ height: '500px' }} />;
}
```

---

## 📈 Performance & Customization

- **Minimal Reflows**: Updates target specific SVG elements via ID, minimizing browser layout recalculations.
- **CSS Animations**: Uses hardware-accelerated CSS animations for the flow paths.
- **Custom Styling**: All elements have semantic classes (e.g., `.glass-card`, `.flow-path`, `.battery-ring-fill`) for advanced CSS overrides.

---

**Version**: 1.0  
**Last Updated**: May 3, 2026
