// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill
// feed, bomb status, buy menu and the overlay panels. It never touches the
// simulation; main.js pushes numbers in and reads callbacks out.
import { SHOP } from './weapons.js';

const OVERLAY_COPY = {
  start: {
    title: 'SANDLINE',
    copy: 'Yard 7, dusk. Five defenders hold Site A. Plant the charge or clear them out — first to 5 rounds takes the match.',
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
  let hitTimer = 0;
  let bannerTimer = 0;
  let lastAmmo = '';
  let lastHealth = '';
  let lastTimer = '';
  let lastMoney = -1;
  let lastScore = '';
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
