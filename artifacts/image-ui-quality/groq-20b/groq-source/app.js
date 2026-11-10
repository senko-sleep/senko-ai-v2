/* app.js – Planetary photo gallery logic */
const sources = JSON.parse(document.getElementById('image-sources').textContent);
const gallery = document.getElementById('gallery');
const filterAllBtn = document.getElementById('filter-all');
const filterMarsBtn = document.getElementById('filter-mars');
const favoriteEarthBtn = document.getElementById('favorite-earth');
const detailEarthBtn = document.getElementById('detail-earth');
const dialog = document.getElementById('dialog');
const dialogImg = document.getElementById('dialog-img');
const dialogTitle = document.getElementById('dialog-title');
const dialogCredit = document.getElementById('dialog-credit');
const closeDialogBtn = document.getElementById('close-dialog');

// Render cards
function renderCards(filter = 'all') {
  gallery.innerHTML = '';
  const filtered = filter === 'all' ? sources : sources.filter(s => s.id === 'mars');
  filtered.forEach(src => {
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-testid', 'card');
    card.innerHTML = `
      <img src="${src.url}" alt="${src.title}">
      <div class="info">
        <h3>${src.title}</h3>
        <p>${src.credit}</p>
      </div>
      <div class="actions">
        ${src.id === 'earth' ? '<button id="favorite-earth" data-testid="favorite-earth" aria-pressed="false">❤</button>' : ''}
        ${src.id === 'earth' ? '<button id="detail-earth" data-testid="detail-earth">Details</button>' : ''}
      </div>
    `;
    gallery.appendChild(card);
  });
}

// Persist favorite Earth
function loadFavorite() {
  const fav = localStorage.getItem('favoriteEarth');
  if (fav === 'true') {
    favoriteEarthBtn.setAttribute('aria-pressed', 'true');
    favoriteEarthBtn.style.color = '#e60000';
  }
}

function toggleFavorite() {
  const pressed = favoriteEarthBtn.getAttribute('aria-pressed') === 'true';
  favoriteEarthBtn.setAttribute('aria-pressed', String(!pressed));
  favoriteEarthBtn.style.color = !pressed ? '#e60000' : '#000';
  localStorage.setItem('favoriteEarth', String(!pressed));
}

// Dialog for Earth details
function openDialog() {
  const earth = sources.find(s => s.id === 'earth');
  dialogImg.src = earth.url;
  dialogImg.alt = earth.title;
  dialogTitle.textContent = earth.title;
  dialogCredit.textContent = earth.credit;
  dialog.showModal();
}

function closeDialog() {
  dialog.close();
}

// Event listeners
filterAllBtn.addEventListener('click', () => renderCards('all'));
filterMarsBtn.addEventListener('click', () => renderCards('mars'));

// Delegate for dynamic buttons
gallery.addEventListener('click', e => {
  if (e.target.id === 'favorite-earth') {
    toggleFavorite();
  }
  if (e.target.id === 'detail-earth') {
    openDialog();
  }
});

closeDialogBtn.addEventListener('click', closeDialog);
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && dialog.open) closeDialog();
});

// Initial render
renderCards('all');
loadFavorite();
