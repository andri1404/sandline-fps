// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill
// feed, bomb status, buy menu and the overlay panels. It never touches the
// simulation; main.js pushes numbers in and reads callbacks out.
import { SHOP } from './weapons.js';

const OVERLAY_COPY = {
  start: {
    title: 'SANDLINE',
    copy: 'Yard 7, dusk. Four teammates at your back, five defenders holding Site A. Plant the charge or clear them out — first to 5 rounds takes the match.',
    action: 'Click to deploy',
  },
  paused: {
    title: 'SANDLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorTag = $('armor-tag');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const timerLabel = $('timer-label');
  const scoreValue = $('score');
  const killfeed = $('killfeed');
  const bombStatus = $('bomb-status');
  const plantWrap = $('plant-wrap');
  const plantFill = $('plant-fill');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyPanel = $('buy');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const vignette = $('vignette');
  const flashOverlay = $('flash-overlay');
  const scopeOverlay = $('scope');
  const grenadeLine = $('grenades');
  const slotPrimary = $('slot-primary');
  const slotSide = $('slot-side');
  const squadList = $('squad-list');
  const defPips = $('def-pips');
  const callouts = $('callouts');
  const minimap = $('minimap');
  const mapCtx = minimap ? minimap.getContext('2d') : null;
  let hitTimer = 0;
  let bannerTimer = 0;
  let lastAmmo = '';
  let lastHealth = '';
  let lastTimer = '';
  let lastMoney = -1;
  let lastScore = '';
  let lastSquad = '';
  let buyHandler = null;

  function renderBuy(money, owned) {
    buyList.innerHTML = '';
    SHOP.forEach((item, index) => {
      const ownedNow = item.id === 'armor' ? owned.armor : item.id === 'flash' ? owned.flash >= 2 : item.id === 'smoke' ? owned.smoke >= 1 : owned.primary === item.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item' + (ownedNow ? ' owned' : '') + (money < item.price && !ownedNow ? ' poor' : '');
      button.dataset.id = item.id;
      button.innerHTML = `<span class="buy-key">${index + 1}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
      button.addEventListener('click', () => {
        if (buyHandler) buyHandler(item.id);
      });
      buyList.appendChild(button);
    });
    buyMoney.textContent = `$${money}`;
  }

  return {
    setHealth(hp, armor) {
      const key = `${hp}|${armor}`;
      if (key === lastHealth) return;
      lastHealth = key;
      healthFill.style.width = `${Math.max(0, hp)}%`;
      healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      healthFill.classList.toggle('low', hp <= 30);
      armorTag.hidden = !armor;
    },
    setAmmo(mag, reserve, name) {
      const key = `${mag}|${reserve}|${name}`;
      if (key === lastAmmo) return;
      lastAmmo = key;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setSlots(primaryName, activeSlot) {
      slotPrimary.textContent = `1 ${primaryName}`;
      slotSide.textContent = '2 P9';
      slotPrimary.classList.toggle('active', activeSlot === 1);
      slotSide.classList.toggle('active', activeSlot === 2);
    },
    setMoney(value) {
      if (value === lastMoney) return;
      lastMoney = value;
      moneyValue.textContent = `$${value}`;
    },
    setGrenades(flash, smoke, selected) {
      grenadeLine.textContent = `G ${selected === 'flash' ? '▸' : ''}FLASH ×${flash}   ${selected === 'smoke' ? '▸' : ''}SMOKE ×${smoke}`;
    },
    setTimer(seconds, phase) {
      const total = Math.max(0, Math.ceil(seconds));
      const key = `${total}|${phase}`;
      if (key === lastTimer) return;
      lastTimer = key;
      timerValue.textContent = `${String(Math.floor(total / 60)).padStart(1, '0')}:${String(total % 60).padStart(2, '0')}`;
      timerLabel.textContent = phase === 'buy' ? 'BUY PHASE' : phase === 'aftermath' ? 'BOMB LIVE' : 'ROUND';
      timerValue.classList.toggle('urgent', phase === 'live' && total <= 15);
    },
    setScore(wins, losses, round) {
      const key = `${wins}|${losses}|${round}`;
      if (key === lastScore) return;
      lastScore = key;
      scoreValue.innerHTML = `YOU <b>${wins}</b> — <b>${losses}</b> DEF &nbsp;·&nbsp; ROUND ${round}`;
    },
    killfeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => {
        line.classList.add('fade');
        setTimeout(() => line.remove(), 600);
      }, 4200);
    },
    // Squad list: you and the four teammates, alive or down, with health.
    // Rebuilds only when the signature changes, so a steady frame costs nothing.
    setSquad(list, defAlive) {
      const key = list.map((m) => `${m.name}:${m.alive ? Math.ceil(m.hp / 5) * 5 : 'x'}`).join('|') + `|d${defAlive}`;
      if (key === lastSquad) return;
      lastSquad = key;
      let html = '';
      for (const m of list) {
        const hp = Math.max(0, Math.ceil(m.hp));
        html += `<div class="squad-row${m.alive ? '' : ' down'}${m.you ? ' you' : ''}"><span class="squad-name">${m.you ? 'YOU' : m.name}</span><span class="squad-bar"><i style="width:${hp}%"></i></span><span class="squad-hp">${m.alive ? hp : 'DOWN'}</span></div>`;
      }
      squadList.innerHTML = html;
      let pips = '';
      for (let i = 0; i < 5; i += 1) pips += i < defAlive ? '●' : '○';
      defPips.textContent = `DEF ${pips}`;
    },
    callout(text) {
      const line = document.createElement('div');
      line.className = 'callout-line';
      line.textContent = text;
      callouts.prepend(line);
      while (callouts.children.length > 3) callouts.removeChild(callouts.lastChild);
      setTimeout(() => {
        line.classList.add('fade');
        setTimeout(() => line.remove(), 600);
      }, 4500);
    },
    clearCallouts() {
      callouts.innerHTML = '';
    },
    // Top-down map of Yard 7: walls, Site A, you, the squad, the defenders.
    drawMinimap(data) {
      if (!mapCtx) return;
      const c = mapCtx;
      const W = minimap.width;
      const H = minimap.height;
      const sx = W / 42.6;
      const sy = H / 38.6;
      const mx = (x) => (x + 21.3) * sx;
      const my = (z) => (z + 19.3) * sy;
      c.clearRect(0, 0, W, H);
      c.fillStyle = 'rgba(25, 20, 16, 0.85)';
      c.fillRect(0, 0, W, H);
      // Site A.
      c.fillStyle = data.planted ? `rgba(255, 122, 26, ${0.35 + 0.2 * Math.sin(performance.now() / 180)})` : 'rgba(255, 122, 26, 0.25)';
      c.fillRect(mx(-4), my(-18.2), 8 * sx, 7 * sy);
      // Walls: outer ring, lane dividers, mid gate with its doorway.
      c.strokeStyle = 'rgba(245, 234, 214, 0.55)';
      c.lineWidth = 1;
      c.strokeRect(mx(-21.3), my(-19.3), 42.6 * sx, 38.6 * sy);
      c.beginPath();
      for (const side of [-7, 7]) {
        c.moveTo(mx(side), my(7));
        c.lineTo(mx(side), my(12));
        c.moveTo(mx(side), my(-6));
        c.lineTo(mx(side), my(3));
      }
      c.moveTo(mx(-7), my(0));
      c.lineTo(mx(-1.3), my(0));
      c.moveTo(mx(1.3), my(0));
      c.lineTo(mx(7), my(0));
      c.stroke();
      // Defenders: ember dots.
      for (const foe of data.foes) {
        if (!foe.alive) continue;
        c.fillStyle = '#ff7a1a';
        c.beginPath();
        c.arc(mx(foe.x), my(foe.z), 3, 0, Math.PI * 2);
        c.fill();
      }
      // Teammates: warm white dots.
      for (const mate of data.mates) {
        if (!mate.alive) continue;
        c.fillStyle = '#f5ead6';
        c.beginPath();
        c.arc(mx(mate.x), my(mate.z), 3, 0, Math.PI * 2);
        c.fill();
      }
      // You: a triangle pointing where you look.
      c.save();
      c.translate(mx(data.px), my(data.pz));
      c.rotate(-data.yaw);
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.moveTo(0, -6);
      c.lineTo(4.5, 5);
      c.lineTo(-4.5, 5);
      c.closePath();
      c.fill();
      c.restore();
    },
    setBomb(text) {
      bombStatus.textContent = text;
      bombStatus.hidden = !text;
    },
    setPlant(progress) {
      if (progress === null) {
        plantWrap.hidden = true;
        return;
      }
      plantWrap.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    banner(titleText, subText, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.hidden = true;
    },
    showBuy(money, owned) {
      renderBuy(money, owned);
      buyPanel.hidden = false;
    },
    updateBuy(money, owned) {
      if (buyPanel.hidden) return;
      renderBuy(money, owned);
    },
    hideBuy() {
      buyPanel.hidden = true;
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    crosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    damageFlash() {
      vignette.classList.remove('hit');
      void vignette.offsetWidth;
      vignette.classList.add('hit');
    },
    flashOverlay(strength) {
      flashOverlay.style.opacity = String(Math.min(1, strength));
      flashOverlay.style.transition = 'none';
      requestAnimationFrame(() => {
        flashOverlay.style.transition = 'opacity 1400ms linear';
        flashOverlay.style.opacity = '0';
      });
    },
    scope(on) {
      scopeOverlay.hidden = !on;
    },
    showOverlay(mode, data) {
      if (mode === 'roundEnd' || mode === 'matchEnd') {
        title.textContent = data.title;
        copy.textContent = data.copy;
        play.textContent = data.action;
      } else {
        const text = OVERLAY_COPY[mode];
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
