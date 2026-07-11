(function () {
  const mission = 'Our mission is to make lunar energy infrastructure easier to place, prove and build—turning remote-sensing evidence into trusted commercial decisions.';
  const shareUrl = new URL('/lunarsol', window.location.origin).href;
  const shareText = `${mission}\n\nDiscover LunarSol: ${shareUrl}`;

  const dialog = document.getElementById('share-dialog');
  const status = document.getElementById('share-status');
  const nativeShare = document.getElementById('native-share');
  const emailShare = document.getElementById('email-share');
  const copyShare = document.getElementById('copy-share');

  document.querySelectorAll('.share-trigger').forEach((button) => {
    button.addEventListener('click', () => {
      status.textContent = '';
      dialog.showModal();
    });
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  emailShare.href = `mailto:?subject=${encodeURIComponent('The LunarSol mission')}&body=${encodeURIComponent(shareText)}`;

  async function copyMission() {
    try {
      await navigator.clipboard.writeText(shareText);
      copyShare.querySelector('span').textContent = 'Copied';
      status.textContent = 'Mission and link copied to your clipboard.';
      window.setTimeout(() => {
        copyShare.querySelector('span').textContent = 'Copy link';
      }, 2200);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = shareText;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
      status.textContent = 'Mission and link copied to your clipboard.';
    }
  }

  nativeShare.addEventListener('click', async () => {
    if (!navigator.share) {
      await copyMission();
      return;
    }

    try {
      await navigator.share({
        title: 'LunarSol — Lunar site intelligence',
        text: mission,
        url: shareUrl
      });
      status.textContent = 'Mission shared.';
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = 'Sharing was unavailable. Try email or copy instead.';
    }
  });

  copyShare.addEventListener('click', copyMission);

  const sites = {
    A: { rank: '01', score: 92, light: '89%', slope: '3.2°', thermal: 'High', area: '6.4 km²' },
    B: { rank: '02', score: 86, light: '84%', slope: '4.7°', thermal: 'High', area: '8.1 km²' },
    C: { rank: '03', score: 78, light: '81%', slope: '6.1°', thermal: 'Moderate', area: '11.7 km²' }
  };

  const siteElements = {
    name: document.getElementById('site-name'),
    rank: document.getElementById('site-rank'),
    score: document.getElementById('site-score'),
    ring: document.getElementById('score-ring'),
    light: document.getElementById('metric-light'),
    slope: document.getElementById('metric-slope'),
    thermal: document.getElementById('metric-thermal'),
    area: document.getElementById('metric-area')
  };

  let selectedSite = 'A';

  function selectSite(siteId) {
    const site = sites[siteId];
    if (!site) return;
    selectedSite = siteId;

    document.querySelectorAll('[data-site]').forEach((element) => {
      element.classList.toggle('is-active', element.dataset.site === siteId);
    });

    siteElements.name.textContent = siteId;
    siteElements.rank.textContent = site.rank;
    siteElements.score.textContent = site.score;
    siteElements.ring.style.setProperty('--score', site.score);
    siteElements.light.textContent = site.light;
    siteElements.slope.textContent = site.slope;
    siteElements.thermal.textContent = site.thermal;
    siteElements.area.textContent = site.area;
  }

  document.querySelectorAll('[data-site]').forEach((element) => {
    element.addEventListener('click', () => selectSite(element.dataset.site));
  });

  document.querySelectorAll('.layer-row').forEach((button) => {
    button.addEventListener('click', () => {
      button.classList.toggle('is-active');
      button.querySelector('i').textContent = button.classList.contains('is-active') ? 'ON' : 'OFF';
    });
  });

  const threshold = document.getElementById('threshold');
  const thresholdValue = document.getElementById('threshold-value');
  threshold.addEventListener('input', () => {
    thresholdValue.textContent = threshold.value;
    document.querySelectorAll('.candidate-zone').forEach((zone) => {
      const score = sites[zone.dataset.site].score;
      zone.style.visibility = score >= Number(threshold.value) ? 'visible' : 'hidden';
    });
  });

  document.getElementById('export-button').addEventListener('click', () => {
    const site = sites[selectedSite];
    const brief = [
      'LUNARSOL — ILLUSTRATIVE CANDIDATE SITE BRIEF',
      `Candidate: Zone ${selectedSite}`,
      `Rank: ${site.rank}`,
      `Suitability: ${site.score}/100`,
      `Annual illumination: ${site.light}`,
      `Median slope: ${site.slope}`,
      `Thermal stability: ${site.thermal}`,
      `Contiguous area: ${site.area}`,
      '',
      'Concept preview only. Production outputs require calibrated mission inputs and engineering validation.',
      shareUrl
    ].join('\n');
    const blob = new Blob([brief], { type: 'text/plain' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `lunarsol-zone-${selectedSite.toLowerCase()}-brief.txt`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  });
})();
