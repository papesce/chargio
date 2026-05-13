/**
 * Power Flow Animation Component
 * A data-driven SVG visualization showing power flow between charger, laptop, and battery.
 */

class PowerFlowComponent {
  constructor(containerId, initialState = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container with id "${containerId}" not found`);
    }

    this.state = {
      isPluggedIn: false,
      batteryLevel: 75,
      isCharging: false,
      powerFlowIntensity: 1.0,
      voltageMv: null,
      amperageMa: null,
      powerW: null,
      systemPowerW: null,
      adapterWatts: null,
      detectedAdapterWatts: null,
      adapterVoltageMv: null,
      adapterCurrentMa: null,
      currentCapacityMah: null,
      maxCapacityMah: null,
      designCapacityMah: null,
      temperatureC: null,
      cycleCount: null,
      timeRemainingMin: null,
      sampledAt: null,
      ...initialState
    };

    this._textCache = {};
    this._attrCache = {};
    this._lowPowerMode = false;
    this._dynamicsScheduled = false;
    this._pendingDynamics = [];

    this.render();
  }

  render() {
    this._textCache = {};
    this._attrCache = {};
    const svg = this.createSVG();
    this.container.innerHTML = '';
    this.container.appendChild(svg);
    this._cacheElements();
    this.updateVisualsBasedOnState();
  }

  _cacheElements() {
    const q = (sel) => this.container.querySelector(sel);
    this._els = {
      'battery-ring-fill': q('#battery-ring-fill'),
      'yellowFlow': q('#yellowFlow'),
      'charger-card': q('#charger-card'),
      'battery-card': q('#battery-card'),
      'charger-to-laptop-base': q('#charger-to-laptop-base'),
      'charger-to-laptop-flow': q('#charger-to-laptop-flow'),
      'battery-to-laptop-flow': q('#battery-to-laptop-flow'),
      'laptop-to-battery-flow': q('#laptop-to-battery-flow'),
    };
  }

  createSVG() {
    const svg = this.el('svg', {
      viewBox: '0 0 900 560',
      width: '100%',
      height: '100%',
      class: 'power-flow-svg',
      role: 'img',
      'aria-label': 'Live power flow visualization'
    });

    this.createDefs(svg);
    this.createBackground(svg);
    this.createFlowPaths(svg);
    this.createCharger(svg);
    this.createLaptop(svg);
    this.createBatteryHero(svg);
    this.createMetricCards(svg);
    this.createHeader(svg);

    return svg;
  }

  createDefs(svg) {
    const defs = this.el('defs');

    defs.appendChild(this.gradient('panelGradient', [
      ['0%', '#101820'],
      ['55%', '#111c29'],
      ['100%', '#172216']
    ], '0%', '0%', '100%', '100%'));

    defs.appendChild(this.gradient('screenGradient', [
      ['0%', '#1b2b3d'],
      ['55%', '#0d1622'],
      ['100%', '#182a21']
    ], '0%', '0%', '100%', '100%'));

    defs.appendChild(this.gradient('blueFlow', [
      ['0%', 'rgba(88, 166, 255, 0)'],
      ['45%', '#58a6ff'],
      ['100%', 'rgba(88, 166, 255, 0)']
    ], '0%', '0%', '100%', '0%'));

    defs.appendChild(this.gradient('greenFlow', [
      ['0%', 'rgba(77, 222, 128, 0)'],
      ['45%', '#4ade80'],
      ['100%', 'rgba(77, 222, 128, 0)']
    ], '0%', '0%', '100%', '0%'));

    defs.appendChild(this.gradient('yellowFlow', [
      ['0%', 'rgba(250, 204, 21, 0)'],
      ['45%', '#facc15'],
      ['100%', 'rgba(250, 204, 21, 0)']
    ], '0%', '0%', '100%', '0%'));

    const glow = this.el('filter', { id: 'softGlow', x: '-40%', y: '-40%', width: '180%', height: '180%' });
    glow.appendChild(this.el('feGaussianBlur', { stdDeviation: '4', result: 'blur' }));
    const merge = this.el('feMerge');
    merge.appendChild(this.el('feMergeNode', { in: 'blur' }));
    merge.appendChild(this.el('feMergeNode', { in: 'SourceGraphic' }));
    glow.appendChild(merge);
    defs.appendChild(glow);


    const style = this.el('style');
    style.textContent = `
      .power-flow-svg {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: 16px;
        background: #0e141b;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .ambient-ring { fill: none; stroke: rgba(255, 255, 255, 0.08); stroke-width: 1; }
      .glass-card { fill: rgba(255, 255, 255, 0.08); stroke: rgba(255, 255, 255, 0.14); stroke-width: 1; }
      .device-stroke { stroke: rgba(226, 232, 240, 0.82); stroke-width: 3; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .muted-stroke { stroke: rgba(148, 163, 184, 0.44); stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .base-path { stroke: rgba(148, 163, 184, 0.18); stroke-width: 9; fill: none; stroke-linecap: round; }
      .flow-path { stroke-width: 5; fill: none; stroke-linecap: round; stroke-dasharray: 24 26; filter: url(#softGlow); }
      .flow-particle { filter: url(#softGlow); opacity: 0.95; }
      .label-kicker { fill: rgba(203, 213, 225, 0.72); font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .label-title { fill: #f8fafc; font-size: 22px; font-weight: 800; letter-spacing: 0; }
      .label-body { fill: rgba(226, 232, 240, 0.82); font-size: 13px; font-weight: 550; letter-spacing: 0; }
      .label-muted { fill: rgba(148, 163, 184, 0.9); font-size: 12px; font-weight: 500; letter-spacing: 0; }
      .metric-value { fill: #f8fafc; font-size: 17px; font-weight: 800; letter-spacing: 0; }
      .metric-label { fill: rgba(203, 213, 225, 0.78); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .battery-percent { fill: #f8fafc; font-size: 48px; font-weight: 850; letter-spacing: 0; }
      .line-current-bg { fill: rgba(15, 23, 42, 0.78); stroke: rgba(255, 255, 255, 0.16); stroke-width: 1; }
      .line-current-label { fill: #f8fafc; font-size: 12px; font-weight: 800; letter-spacing: 0; }
      .battery-ring-track { fill: none; stroke: rgba(255, 255, 255, 0.12); stroke-width: 16; }
      .battery-ring-fill { fill: none; stroke-width: 16; stroke-linecap: round; filter: url(#softGlow); transform: rotate(-90deg); transform-origin: 720px 230px; }
      @keyframes flowForward {
        from { stroke-dashoffset: 60px; }
        to { stroke-dashoffset: 0; }
      }
      @keyframes flowReverse {
        from { stroke-dashoffset: 0; }
        to { stroke-dashoffset: 60px; }
      }
      @keyframes breathe {
        0%, 100% { opacity: 0.72; }
        50% { opacity: 1; }
      }
      .active-flow { animation: flowForward 1.4s linear infinite; }
      .reverse-flow { animation: flowReverse 1.4s linear infinite; }
      .breathing { animation: breathe 2.6s ease-in-out infinite; }
      .card-shadow { filter: drop-shadow(0 18px 18px rgba(0, 0, 0, 0.28)); }
    `;
    defs.appendChild(style);

    svg.appendChild(defs);
  }

  createBackground(svg) {
    svg.appendChild(this.el('rect', { x: '0', y: '0', width: '900', height: '560', rx: '16', fill: 'url(#panelGradient)' }));
    svg.appendChild(this.el('circle', { cx: '720', cy: '230', r: '174', fill: 'rgba(77, 222, 128, 0.07)' }));
    svg.appendChild(this.el('circle', { cx: '248', cy: '230', r: '168', fill: 'rgba(88, 166, 255, 0.07)' }));
    svg.appendChild(this.el('circle', { cx: '720', cy: '230', r: '132', class: 'ambient-ring' }));
    svg.appendChild(this.el('circle', { cx: '450', cy: '242', r: '188', class: 'ambient-ring' }));
  }

  createFlowPaths(svg) {
    const group = this.el('g', { id: 'flow-group' });
    const paths = [
      ['charger-to-laptop', this.getConnectionPath('chargerToLaptop'), 'url(#blueFlow)'],
      ['battery-to-laptop', this.getConnectionPath('batteryToLaptop'), 'url(#yellowFlow)'],
      ['laptop-to-battery', this.getConnectionPath('laptopToBattery'), 'url(#greenFlow)']
    ];

    paths.forEach(([name, d, stroke]) => {
      group.appendChild(this.el('path', { id: `${name}-base`, d, class: 'base-path' }));
      group.appendChild(this.el('path', { id: `${name}-flow`, d, class: 'flow-path', stroke }));
    });

    group.appendChild(this.createParticle('charger-particle-a', this.getConnectionPath('chargerToLaptop'), '#58a6ff', '0s'));
    group.appendChild(this.createParticle('charger-particle-b', this.getConnectionPath('chargerToLaptop'), '#58a6ff', '-0.7s'));
    group.appendChild(this.createParticle('battery-particle-a', this.getConnectionPath('batteryToLaptop'), '#facc15', '0s'));
    group.appendChild(this.createParticle('battery-particle-b', this.getConnectionPath('batteryToLaptop'), '#facc15', '-0.8s'));
    group.appendChild(this.createParticle('charge-particle-a', this.getConnectionPath('laptopToBattery'), '#4ade80', '0s'));
    group.appendChild(this.createParticle('charge-particle-b', this.getConnectionPath('laptopToBattery'), '#4ade80', '-0.9s'));

    svg.appendChild(group);
  }

  createParticle(id, pathD, color, begin) {
    const circle = this.el('circle', { id, r: '5', fill: color, class: 'flow-particle' });
    const motion = this.el('animateMotion', {
      dur: '2s',
      begin,
      repeatCount: 'indefinite',
      path: pathD
    });
    circle.appendChild(motion);
    return circle;
  }

  createCharger(svg) {
    const group = this.el('g', { id: 'charger-group', class: 'card-shadow' });
    group.appendChild(this.el('rect', { id: 'charger-card', x: '62', y: '178', width: '118', height: '132', rx: '26', class: 'glass-card' }));
    group.appendChild(this.el('path', { d: 'M 112 212 L 94 250 H 116 L 102 282 L 142 236 H 119 Z', fill: 'rgba(88, 166, 255, 0.2)', stroke: '#58a6ff', 'stroke-width': '3', 'stroke-linejoin': 'round' }));
    group.appendChild(this.el('line', { x1: '89', y1: '198', x2: '89', y2: '222', class: 'muted-stroke' }));
    group.appendChild(this.el('line', { x1: '153', y1: '198', x2: '153', y2: '222', class: 'muted-stroke' }));
    
    group.appendChild(this.el('rect', { 
      id: 'charger-wattage-bg', 
      x: '86', y: '276', width: '70', height: '22', rx: '11', 
      fill: 'rgba(88, 166, 255, 0.08)', 
      stroke: 'rgba(88, 166, 255, 0.25)' 
    }));
    group.appendChild(this.text(this.formatNumber(this.state.adapterWatts, ' W', 0), 121, 292, 'label-kicker', { anchor: 'middle', id: 'charger-wattage-label' }));

    group.appendChild(this.text('Charger', 121, 342, 'label-body', { anchor: 'middle' }));
    group.appendChild(this.text(this.getChargerHeadline(), 121, 363, 'label-muted', { anchor: 'middle', id: 'charger-summary-label' }));
    svg.appendChild(group);
  }

  createLaptop(svg) {
    const group = this.el('g', { id: 'laptop-group', class: 'card-shadow' });
    group.appendChild(this.el('rect', { x: '330', y: '150', width: '240', height: '158', rx: '18', fill: 'url(#screenGradient)', stroke: 'rgba(226, 232, 240, 0.24)', 'stroke-width': '2' }));
    group.appendChild(this.el('rect', { x: '348', y: '168', width: '204', height: '122', rx: '12', fill: 'rgba(2, 6, 23, 0.62)', stroke: 'rgba(255,255,255,0.08)' }));
    group.appendChild(this.el('path', { d: 'M 330 310 H 570 L 618 356 Q 623 362 614 362 H 286 Q 277 362 282 356 Z', fill: 'rgba(203, 213, 225, 0.16)', stroke: 'rgba(226, 232, 240, 0.22)', 'stroke-width': '2' }));
    group.appendChild(this.el('rect', { x: '391', y: '330', width: '118', height: '12', rx: '6', fill: 'rgba(226, 232, 240, 0.16)' }));
    group.appendChild(this.el('circle', { id: 'laptop-status-dot', cx: '450', cy: '226', r: '30', fill: 'rgba(88, 166, 255, 0.16)', class: 'breathing' }));
    group.appendChild(this.el('path', { d: 'M 431 226 H 469 M 450 207 V 245', class: 'device-stroke', opacity: '0.74' }));
    // group.appendChild(this.text('Laptop', 450, 404, 'label-body', { anchor: 'middle' }));
    //group.appendChild(this.text(this.getSourceInsight(), 450, 425, 'label-muted', { anchor: 'middle', id: 'source-insight-label' }));
    svg.appendChild(group);
  }

  createBatteryHero(svg) {
    const group = this.el('g', { id: 'battery-hero-group', class: 'card-shadow' });
    group.appendChild(this.el('rect', { id: 'battery-card', x: '610', y: '88', width: '220', height: '290', rx: '34', class: 'glass-card' }));
    
    group.appendChild(this.el('rect', { 
      id: 'battery-voltage-bg', 
      x: '725', y: '108', width: '80', height: '22', rx: '11', 
      fill: 'rgba(255, 255, 255, 0.05)', 
      stroke: 'rgba(255, 255, 255, 0.14)' 
    }));
    group.appendChild(this.text(this.formatVoltage(this.state.voltageMv), 765, 124, 'label-kicker', { anchor: 'middle', id: 'battery-voltage-label' }));
    
    group.appendChild(this.el('circle', { cx: '720', cy: '230', r: '82', class: 'battery-ring-track' }));
    group.appendChild(this.el('circle', { id: 'battery-ring-fill', cx: '720', cy: '230', r: '82', class: 'battery-ring-fill', stroke: '#4ade80' }));
    group.appendChild(this.text(`${this.state.batteryLevel}%`, 720, 220, 'battery-percent', { anchor: 'middle', id: 'battery-text' }));
    group.appendChild(this.text(this.getBatteryStateLabel(), 720, 248, 'label-body', { anchor: 'middle', id: 'battery-state-label' }));
    group.appendChild(this.text(this.getBatterySubLabel(), 720, 280, 'label-muted', { anchor: 'middle', id: 'battery-sub-label' }));
    group.appendChild(this.el('rect', { x: '678', y: '331', width: '84', height: '22', rx: '11', id: 'battery-pill-bg', fill: 'rgba(148, 163, 184, 0.1)', stroke: 'rgba(148, 163, 184, 0.3)' }));
    group.appendChild(this.text(this.getBatteryTempLabel(), 720, 346, 'label-muted', { anchor: 'middle', id: 'battery-temp-pill' }));
    svg.appendChild(group);
  }

  createMetricCards(svg) {
    const group = this.el('g', { id: 'metric-card-group' });
    group.appendChild(this.metricCard(46, 446, 190, 'Power Source', this.getSourceCardValue(), this.getSourceCardDetail(), '#58a6ff', 'source-card'));
    group.appendChild(this.metricCard(256, 446, 190, 'Battery Flow', this.getBatteryFlowValue(), this.getBatteryFlowDetail(), this.getBatteryFlowColor(), 'battery-flow-card'));
    group.appendChild(this.metricCard(466, 446, 190, 'Battery Health', this.getBatteryHealthValue(), this.getBatteryHealthDetail(), '#4ade80', 'battery-health-card'));
    group.appendChild(this.metricCard(676, 446, 178, 'Remaining', this.getSessionValue(), this.getSessionDetail(), '#facc15', 'session-card'));
    svg.appendChild(group);
  }

  createHeader(svg) {
    const group = this.el('g', { id: 'header-group' });
    group.appendChild(this.text('Power Flow', 48, 54, 'label-kicker'));
    group.appendChild(this.text(this.getPrimaryMessage(), 48, 84, 'label-title', { id: 'primary-message-label' }));
    group.appendChild(this.text(this.getSecondaryMessage(), 48, 108, 'label-body', { id: 'secondary-message-label' }));
    svg.appendChild(group);
  }

  metricCard(x, y, width, label, value, detail, accent, idPrefix) {
    const group = this.el('g', { class: 'card-shadow', id: idPrefix });
    group.appendChild(this.el('rect', { x, y, width, height: '82', rx: '18', class: 'glass-card' }));
    group.appendChild(this.el('rect', { x: x + 14, y: y + 15, width: '4', height: '52', rx: '2', fill: accent, id: `${idPrefix}-accent` }));
    group.appendChild(this.text(label, x + 28, y + 29, 'metric-label'));
    group.appendChild(this.text(value, x + 28, y + 53, 'metric-value', { id: `${idPrefix}-value` }));
    group.appendChild(this.text(detail, x + 28, y + 72, 'label-muted', { id: `${idPrefix}-detail` }));
    
    // Tooltip support
    const title = this.el('title', { id: `${idPrefix}-tooltip` });
    group.appendChild(title);
    
    return group;
  }

  getConnectionPath(name) {
    const paths = {
      chargerToLaptop: 'M 180 244 C 244 206 285 204 330 236',
      batteryToLaptop: 'M 635 288 C 570 356 508 370 450 360',
      laptopToBattery: 'M 570 252 C 610 226 628 214 638 210'
    };

    return paths[name];
  }

  updateVisualsBasedOnState() {
    const level = this.clamp(Number(this.state.batteryLevel) || 0, 0, 100);
    const ring = this._els?.['battery-ring-fill'];
    const batteryColor = this.getBatteryColor();
    if (ring) {
      const circumference = 2 * Math.PI * 82;
      ring.setAttribute('stroke-dasharray', `${circumference}`);
      ring.setAttribute('stroke-dashoffset', `${circumference * (1 - level / 100)}`);
      ring.setAttribute('stroke', batteryColor);
    }

    // Sync yellow flow gradient and particles with battery ring color
    const yellowFlow = this._els?.['yellowFlow'];
    if (yellowFlow) {
      const stops = yellowFlow.querySelectorAll('stop');
      if (stops.length >= 3) {
        stops[0].setAttribute('stop-color', this.getBatteryColor(0));
        stops[1].setAttribute('stop-color', batteryColor);
        stops[2].setAttribute('stop-color', this.getBatteryColor(0));
      }
    }
    this.setAttr('#battery-particle-a', 'fill', batteryColor);
    this.setAttr('#battery-particle-b', 'fill', batteryColor);

    this.setText('battery-text', `${Math.round(level)}%`);
    this.setText('battery-voltage-label', this.formatVoltage(this.state.voltageMv));
    this.setText('battery-state-label', this.getBatteryStateLabel());
    this.setText('battery-sub-label', this.getBatterySubLabel());
    this.setText('battery-temp-pill', this.getBatteryTempLabel());
    this.setText('primary-message-label', this.getPrimaryMessage());
    this.setText('secondary-message-label', this.getSecondaryMessage());
    this.setText('source-insight-label', this.getSourceInsight());
    this.setText('charger-summary-label', this.getChargerHeadline());
    
    const displayWatts = this.state.systemPowerW ?? this.state.detectedAdapterWatts ?? this.state.adapterWatts;
    this.setText('charger-wattage-label', this.formatNumber(displayWatts, ' W', 0));

    this.setText('source-card-value', this.getSourceCardValue());
    this.setText('source-card-detail', this.getSourceCardDetail());
    this.setText('battery-flow-card-value', this.getBatteryFlowValue());
    this.setText('battery-flow-card-detail', this.getBatteryFlowDetail());
    this.setText('battery-health-card-value', this.getBatteryHealthValue());
    this.setText('battery-health-card-detail', this.getBatteryHealthDetail());
    this.setText('battery-health-card-tooltip', this.getBatteryHealthTooltip());
    this.setText('session-card-value', this.getSessionValue());
    this.setText('session-card-detail', this.getSessionDetail());

    const amps = Number(this.state.amperageMa) || 0;
    const isDischarging = amps < 0;
    const isCharging = amps > 0;
    const isPluggedIn = !!this.state.isPluggedIn;

    // Sync battery percentage color with flow state
    let percentColor = '#f8fafc'; // Default white
    if (isDischarging) percentColor = batteryColor;
    else if (isCharging) percentColor = '#4ade80'; // Green
    this.setAttr('#battery-text', 'fill', percentColor);

    // Temperature pill - fixed slate/blue theme
    this.setAttr('#battery-pill-bg', 'fill', 'rgba(148, 163, 184, 0.1)');
    this.setAttr('#battery-pill-bg', 'stroke', 'rgba(148, 163, 184, 0.3)');
    
    this.setAttr('#battery-voltage-bg', 'fill', this.getBatteryColor(0.08));
    this.setAttr('#battery-voltage-bg', 'stroke', this.getBatteryColor(0.25));
    
    this.setAttr('#charger-wattage-bg', 'opacity', isPluggedIn ? '1' : '0');
    this.setAttr('#charger-wattage-label', 'opacity', isPluggedIn ? '1' : '0');

    // Highlight charger border when connected
    const chargerCard = this._els?.['charger-card'];
    if (chargerCard) {
      chargerCard.style.stroke = isPluggedIn ? 'rgba(88, 166, 255, 0.8)' : 'rgba(255, 255, 255, 0.14)';
      chargerCard.style.strokeWidth = isPluggedIn ? '2px' : '1px';
      chargerCard.setAttribute('filter', isPluggedIn ? 'url(#softGlow)' : '');
    }

    const batteryCard = this._els?.['battery-card'];
    if (batteryCard) {
      const isRunningOnBattery = !isPluggedIn;
      batteryCard.style.stroke = isRunningOnBattery ? this.getBatteryColor(0.8) : 'rgba(255, 255, 255, 0.14)';
      batteryCard.style.strokeWidth = isRunningOnBattery ? '2px' : '1px';
      batteryCard.setAttribute('filter', isRunningOnBattery ? 'url(#softGlow)' : '');
    }

    const chargerBase = this._els?.['charger-to-laptop-base'];
    if (chargerBase) {
      chargerBase.style.stroke = isPluggedIn ? 'rgba(88, 166, 255, 0.25)' : 'rgba(148, 163, 184, 0.18)';
    }

    this.setAttr('#battery-flow-card-accent', 'fill', this.getBatteryFlowColor());
    this.setAttr('#laptop-status-dot', 'fill', isPluggedIn ? 'rgba(88, 166, 255, 0.18)' : 'rgba(250, 204, 21, 0.18)');

    const adapterAmps = this.getChargerToLaptopCurrentMa();
    const hasAdapterFlow = isPluggedIn && adapterAmps > 0;

    this.toggleFlow('charger-to-laptop', isPluggedIn, hasAdapterFlow ? 'active-flow' : '');
    this.toggleFlow('battery-to-laptop', isDischarging, 'active-flow');
    this.toggleFlow('laptop-to-battery', isCharging, 'active-flow');

    this.toggleParticles(['charger-particle-a', 'charger-particle-b'], hasAdapterFlow);
    this.toggleParticles(['battery-particle-a', 'battery-particle-b'], isDischarging);
    this.toggleParticles(['charge-particle-a', 'charge-particle-b'], isCharging);

    const baseIntensity = Math.max(0.2, Number(this.state.powerFlowIntensity) || 1);
    const chargerIntensity = Math.max(0.1, (Math.abs(adapterAmps) / 6000) * 2.2 + 0.1);
    const batteryIntensity = Math.max(0.1, (Math.abs(amps) / 6000) * 2.2 + 0.1);

    this._pendingDynamics = [
      { type: 'path', args: ['charger-to-laptop', chargerIntensity] },
      { type: 'path', args: ['battery-to-laptop', batteryIntensity] },
      { type: 'path', args: ['laptop-to-battery', batteryIntensity] },
      { type: 'particle', args: [['charger-particle-a', 'charger-particle-b'], chargerIntensity] },
      { type: 'particle', args: [['battery-particle-a', 'battery-particle-b'], batteryIntensity] },
      { type: 'particle', args: [['charge-particle-a', 'charge-particle-b'], batteryIntensity] },
    ];
    this._scheduleDynamicsUpdate();
  }

  _scheduleDynamicsUpdate() {
    if (this._dynamicsScheduled) return;
    this._dynamicsScheduled = true;
    requestAnimationFrame(() => {
      this._dynamicsScheduled = false;
      for (const { type, args } of this._pendingDynamics) {
        if (type === 'path') this.updatePathDynamics(...args);
        else this.updateParticleDynamics(...args);
      }
      this._pendingDynamics = [];
    });
  }

  updatePathDynamics(id, intensity) {
    const path = this._els?.[`${id}-flow`] || this.container.querySelector(`#${id}-flow`);
    if (!path) return;
    const duration = `${Math.max(0.5, 2.2 / intensity)}s`;
    const strokeWidth = 1.5 + (intensity * 3.5);
    path.style.animationDuration = duration;
    path.setAttribute('stroke-width', strokeWidth);
  }

  updateParticleDynamics(ids, intensity) {
    const multiplier = this._lowPowerMode ? 1.5 : 1.0;
    const duration = `${Math.max(0.5, (2.2 / intensity) * multiplier)}s`;
    const radius = 2 + (intensity * 3);
    ids.forEach(id => {
      const particle = this.container.querySelector(`#${id}`);
      if (!particle) return;
      particle.setAttribute('r', radius);
      const motion = particle.querySelector('animateMotion');
      if (motion) motion.setAttribute('dur', duration);
    });
  }

  toggleFlow(prefix, active, animationClass) {
    const base = this.container.querySelector(`#${prefix}-base`);
    const flow = this.container.querySelector(`#${prefix}-flow`);
    if (base) base.setAttribute('opacity', active ? '1' : '0.36');
    if (flow) {
      flow.setAttribute('opacity', active ? '1' : '0');
      flow.setAttribute('class', `flow-path ${active ? animationClass : ''}`.trim());
    }
  }

  toggleParticles(ids, active) {
    ids.forEach((id) => {
      const isSecondary = id.endsWith('-b');
      const show = active && !(this._lowPowerMode && isSecondary);
      this.setAttr(`#${id}`, 'opacity', show ? '0.95' : '0');
      this.setAttr(`#${id}`, 'visibility', show ? 'visible' : 'hidden');
    });
  }

  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.updateVisualsBasedOnState();
  }

  setLowPowerMode(enabled) {
    if (this._lowPowerMode === enabled) return;
    this._lowPowerMode = enabled;
    this.updateVisualsBasedOnState();
  }

  getState() {
    return { ...this.state };
  }

  destroy() {
    this.container.innerHTML = '';
  }

  getPrimaryMessage() {
    if (!this.state.isPluggedIn) return 'Running on battery';
    if (this.state.isCharging) return 'Charging through the laptop';
    if (this.state.batteryLevel >= 99) return 'Plugged in, battery full';
    return 'Plugged in, battery holding';
  }

  getSecondaryMessage() {
    const isPluggedIn = !!this.state.isPluggedIn;
    const isCharging = !!this.state.isCharging;
    const level = Number(this.state.batteryLevel) || 0;

    if (isPluggedIn && !isCharging) {
      if (level >= 98) return 'Battery is fully charged and maintained.';
      return 'Power is supplied by the adapter; battery is idle.';
    }

    if (isCharging) {
      return 'Adapter power is flowing into the battery.';
    } else if (!isPluggedIn) {
      return 'Battery is supplying power to the system.';
    }
    return 'Battery is maintained at current level.';
  }

  getSourceInsight() {
    if (!this.state.isPluggedIn) return 'Battery is powering the system';
    if (this.state.isCharging) return 'Charger powers laptop and refills battery';
    return 'Charger powers laptop while battery rests';
  }

  getBatteryStateLabel() {
    if (this.state.isCharging) return 'Charging';
    if (this.state.isPluggedIn && this.state.batteryLevel >= 99) return 'Full';
    if (this.state.isPluggedIn) return 'Holding';
    return 'Discharging';
  }

  getBatterySubLabel() {
    return `${this.formatCapacity(this.state.currentCapacityMah, this.state.maxCapacityMah)}`;
  }

  getBatteryTempLabel() {
    return `${this.formatNumber(this.state.temperatureC, ' C', 1)}`;
  }

  getChargerHeadline() {
    if (!this.state.isPluggedIn) return 'Disconnected';
    const watts = this.state.detectedAdapterWatts ?? this.state.adapterWatts;
    return `${this.formatNumber(watts, ' W', 0)} adapter`;
  }

  getSourceCardValue() {
    if (!this.state.isPluggedIn) return 'Battery';
    return this.formatInteger(this.getChargerToLaptopCurrentMa(), ' mA');
  }

  getSourceCardDetail() {
    if (!this.state.isPluggedIn) return 'No external power';
    return `${this.formatVoltage(this.state.adapterVoltageMv)}`;
  }

  getBatteryFlowValue() {
    const current = this.state.amperageMa;
    if (current === null || current === undefined || Number.isNaN(Number(current))) return '--';
    if (Number(current) < 0) return `${this.formatInteger(Math.abs(Number(current)))} mA out`;
    if (Number(current) > 0) return `${this.formatInteger(Number(current))} mA in`;
    return 'Idle';
  }

  getBatteryFlowDetail() {
    return `${this.formatNumber(this.state.powerW, ' W', 1)}`;
  }

  getBatteryHealthValue() {
    const max = Number(this.state.maxCapacityMah);
    const design = Number(this.state.designCapacityMah);
    if (!max || !design || Number.isNaN(max) || Number.isNaN(design)) return '--';
    const health = (max / design) * 100;
    return `${health.toFixed(1)}% Health`;
  }

  getBatteryHealthDetail() {
    const cycles = this.state.cycleCount;
    if (cycles === null || cycles === undefined) return '-- cycles';
    return `${this.formatInteger(cycles)} / 1000 cycles`;
  }

  getBatteryHealthTooltip() {
    const max = Number(this.state.maxCapacityMah);
    const design = Number(this.state.designCapacityMah);
    if (!max || !design || Number.isNaN(max) || Number.isNaN(design)) return '';
    return `Full Charge Capacity: ${this.formatInteger(max)} mAh / Design Capacity: ${this.formatInteger(design)} mAh`;
  }

  getSessionValue() {
    return this.formatMinutes(this.state.timeRemainingMin);
  }

  getSessionDetail() {
    return `Sampled ${this.formatSampleTime(this.state.sampledAt)}`;
  }

  getBatteryFlowColor() {
    const current = Number(this.state.amperageMa);
    if (Number.isNaN(current) || current === 0) return '#94a3b8';
    return current > 0 ? '#4ade80' : this.getBatteryColor();
  }

  getBatteryColor(alpha) {
    const level = Number(this.state.batteryLevel);
    let color = [74, 222, 128];
    if (level <= 20) color = [248, 113, 113];
    else if (level <= 55 || (this.state.isPluggedIn && !this.state.isCharging && level < 99)) color = [250, 204, 21];
    if (alpha === undefined) return `rgb(${color.join(', ')})`;
    return `rgba(${color.join(', ')}, ${alpha})`;
  }

  getChargerToLaptopCurrentMa() {
    const watts = this.state.systemPowerW ?? this.state.adapterWatts;
    const volts = this.state.adapterVoltageMv;
    
    // If we have variable watts and volts, calculate actual current
    if (watts !== null && watts !== undefined && volts) {
      return Math.round((Number(watts) / (Number(volts) / 1000)) * 1000);
    }

    // Fallback to adapterCurrentMa if available
    if (this.state.adapterCurrentMa !== null && this.state.adapterCurrentMa !== undefined) {
      return Number(this.state.adapterCurrentMa);
    }

    return 0;
  }

  formatInteger(value, suffix = '') {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    return `${Math.round(Number(value)).toLocaleString()}${suffix}`;
  }

  formatNumber(value, suffix = '', digits = 1) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
    return `${Number(value).toFixed(digits)}${suffix}`;
  }

  formatVoltage(valueMv) {
    if (valueMv === null || valueMv === undefined || Number.isNaN(Number(valueMv))) return '--';
    return `${(Number(valueMv) / 1000).toFixed(2)} V`;
  }

  formatCapacity(currentMah, maxMah) {
    const current = this.formatInteger(currentMah);
    const max = this.formatInteger(maxMah);
    if (current === '--' && max === '--') return '--';
    return `${current} / ${max} mAh`;
  }

  formatMinutes(value) {
    if (
      value === null ||
      value === undefined ||
      Number.isNaN(Number(value)) ||
      Number(value) <= 0 ||
      Number(value) === 65535
    ) {
      return '--';
    }
    const minutes = Math.round(Number(value));
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (!hours) return `${mins}m`;
    return `${hours}h ${mins}m`;
  }

  formatSampleTime(value) {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  setText(id, value) {
    const v = String(value);
    if (this._textCache[id] === v) return;
    this._textCache[id] = v;
    const element = this._els?.[id] || this.container.querySelector(`#${id}`);
    if (element) element.textContent = v;
  }

  setAttr(selector, attr, value) {
    const v = String(value);
    const key = `${selector}|${attr}`;
    if (this._attrCache[key] === v) return;
    this._attrCache[key] = v;
    const element = this.container.querySelector(selector);
    if (element) element.setAttribute(attr, v);
  }

  text(content, x, y, className, options = {}) {
    const attrs = { x, y, class: className };
    if (options.id) attrs.id = options.id;
    if (options.anchor) attrs['text-anchor'] = options.anchor;
    const node = this.el('text', attrs);
    node.textContent = content;
    return node;
  }

  gradient(id, stops, x1, y1, x2, y2) {
    const gradient = this.el('linearGradient', { id, x1, y1, x2, y2 });
    stops.forEach(([offset, color]) => {
      gradient.appendChild(this.el('stop', { offset, 'stop-color': color }));
    });
    return gradient;
  }

  el(tagName, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    return element;
  }

  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PowerFlowComponent;
}
