'use strict';

/* =========================================================
   Константы
   ========================================================= */

const STORAGE_KEY = 'taskTracker.v1';
const DATA_VERSION = 1;

const PRIORITIES = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };
const STATUSES = { todo: 'К выполнению', in_progress: 'В работе', done: 'Готово' };
const SORTS = { dueDate: 'Сортировка: по сроку', priority: 'Сортировка: по приоритету' };
const THEMES = { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' };
const VIEWS = ['list', 'board'];

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

// Значение фильтра «Без направления» / «Без проекта»
const NONE = '__none';

// Редактируемые справочники: направления и проекты
const LISTS = {
  directions: { prefix: 'd', taskField: 'directionId', noun: 'направление', emptyLabel: 'Без направления', allLabel: 'Все направления' },
  projects: { prefix: 'p', taskField: 'projectId', noun: 'проект', emptyLabel: 'Без проекта', allLabel: 'Все проекты' },
};

/* =========================================================
   Элементы страницы
   ========================================================= */

const els = {
  list: document.getElementById('task-list'),
  board: document.getElementById('task-board'),
  empty: document.getElementById('empty-state'),
  emptyTitle: document.getElementById('empty-title'),
  emptyText: document.getElementById('empty-text'),
  emptyResetBtn: document.getElementById('empty-reset-btn'),
  counter: document.getElementById('task-counter'),
  notice: document.getElementById('notice'),
  addBtn: document.getElementById('add-task-btn'),

  search: document.getElementById('search-input'),
  viewButtons: document.querySelectorAll('.view-switch__btn'),
  filterDirection: document.getElementById('filter-direction'),
  filterProject: document.getElementById('filter-project'),
  filterPriority: document.getElementById('filter-priority'),
  filterStatus: document.getElementById('filter-status'),
  sortSelect: document.getElementById('sort-select'),
  summaryRow: document.getElementById('filter-summary-row'),
  summary: document.getElementById('filter-summary'),
  resetFiltersBtn: document.getElementById('reset-filters-btn'),

  dialog: document.getElementById('task-dialog'),
  dialogTitle: document.getElementById('dialog-title'),
  form: document.getElementById('task-form'),
  deleteBtn: document.getElementById('delete-task-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  fields: {
    title: document.getElementById('field-title'),
    description: document.getElementById('field-description'),
    dueDate: document.getElementById('field-due-date'),
    priority: document.getElementById('field-priority'),
    status: document.getElementById('field-status'),
    project: document.getElementById('field-project'),
    direction: document.getElementById('field-direction'),
  },

  settingsBtn: document.getElementById('settings-btn'),
  settingsDialog: document.getElementById('settings-dialog'),
  settingsCloseBtn: document.getElementById('settings-close-btn'),
  settingsMessage: document.getElementById('settings-message'),
  settingsLists: {
    directions: document.getElementById('directions-list'),
    projects: document.getElementById('projects-list'),
  },
  settingsAddForms: document.querySelectorAll('.settings-add'),
  themeSelect: document.getElementById('theme-select'),
  exportBtn: document.getElementById('export-btn'),
  importBtn: document.getElementById('import-btn'),
  importInput: document.getElementById('import-input'),
};

/* =========================================================
   Состояние приложения
   ========================================================= */

let data = null;            // все данные: задачи, справочники, настройки
let editingTaskId = null;   // id задачи в окне редактирования (null — новая)
let draggedTaskId = null;   // id задачи, которую сейчас перетаскивают на доске
const messageTimers = new Map();

// Поиск и фильтры не сохраняются — при перезагрузке сбрасываются
const filters = { search: '', direction: '', project: '', priority: '', status: '' };

/* =========================================================
   Хранение данных (localStorage)
   ========================================================= */

function createDefaultData() {
  return {
    version: DATA_VERSION,
    tasks: [],
    directions: [
      { id: 'd_sales', name: 'Продажи' },
      { id: 'd_marketing', name: 'Маркетинг' },
      { id: 'd_finance', name: 'Финансы' },
      { id: 'd_education', name: 'Образование' },
    ],
    projects: [{ id: 'p_1', name: 'Проект 1' }],
    settings: { view: 'list', theme: 'system', sort: 'dueDate' },
  };
}

// Приводит задачу к правильному виду, даже если в ней чего-то не хватает
function normalizeTask(task) {
  const now = new Date().toISOString();
  return {
    id: typeof task.id === 'string' ? task.id : generateId('t'),
    title: String(task.title).trim() || 'Без названия',
    description: typeof task.description === 'string' ? task.description : '',
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ? task.dueDate : null,
    priority: task.priority in PRIORITIES ? task.priority : 'medium',
    status: task.status in STATUSES ? task.status : 'todo',
    projectId: typeof task.projectId === 'string' ? task.projectId : null,
    directionId: typeof task.directionId === 'string' ? task.directionId : null,
    createdAt: typeof task.createdAt === 'string' ? task.createdAt : now,
    updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : now,
  };
}

function normalizeList(list, fallback) {
  if (!Array.isArray(list)) return fallback;
  return list.filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string');
}

// Проверяет загруженные данные и дополняет недостающее значениями по умолчанию
function normalizeData(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Неверный формат данных');
  const defaults = createDefaultData();

  const directions = normalizeList(raw.directions, defaults.directions);
  const projects = normalizeList(raw.projects, defaults.projects);
  const directionIds = new Set(directions.map((d) => d.id));
  const projectIds = new Set(projects.map((p) => p.id));

  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks.filter((t) => t && typeof t.title === 'string').map(normalizeTask)
    : [];
  // Ссылки на несуществующие направления/проекты убираем
  tasks.forEach((task) => {
    if (task.directionId && !directionIds.has(task.directionId)) task.directionId = null;
    if (task.projectId && !projectIds.has(task.projectId)) task.projectId = null;
  });

  const rawSettings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const settings = { ...defaults.settings, ...rawSettings };
  if (!VIEWS.includes(settings.view)) settings.view = defaults.settings.view;
  if (!(settings.theme in THEMES)) settings.theme = defaults.settings.theme;
  if (!(settings.sort in SORTS)) settings.sort = defaults.settings.sort;

  return { version: DATA_VERSION, tasks, directions, projects, settings };
}

function loadData() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    showNotice('Браузер не разрешает сохранять данные. Задачи пропадут после закрытия страницы.', 'error');
    return createDefaultData();
  }

  if (!raw) return createDefaultData();

  try {
    return normalizeData(JSON.parse(raw));
  } catch (error) {
    // Данные повреждены: откладываем их в отдельный ключ, чтобы не потерять насовсем
    try {
      localStorage.setItem(`${STORAGE_KEY}.corrupted`, raw);
    } catch (_) { /* ничего не поделать */ }
    showNotice('Сохранённые данные повреждены, поэтому трекер начат заново. Старые данные отложены в резервный ключ.', 'error');
    return createDefaultData();
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    showNotice('Не удалось сохранить изменения. Возможно, память браузера переполнена.', 'error');
    return false;
  }
}

/* =========================================================
   Вспомогательные функции
   ========================================================= */

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Создаёт элемент с классом и текстом (текст всегда как текст, не как HTML)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// '2026-11-10' -> '10.11.2026'
function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

// Сегодняшняя дата по местному времени в формате ГГГГ-ММ-ДД
function todayISO() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// 'overdue' — просрочено, 'today' — срок сегодня, null — всё в порядке
function getDueState(task) {
  if (!task.dueDate || task.status === 'done') return null;
  const today = todayISO();
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  return null;
}

function findName(list, id) {
  const item = list.find((entry) => entry.id === id);
  return item ? item.name : null;
}

// Заполняет выпадающий список вариантами
function fillSelect(select, options, emptyLabel) {
  select.replaceChildren();
  if (emptyLabel) select.append(new Option(emptyLabel, ''));
  options.forEach(({ value, label }) => select.append(new Option(label, value)));
}

function dictToOptions(dict) {
  return Object.entries(dict).map(([value, label]) => ({ value, label }));
}

function listToOptions(list) {
  return list.map(({ id, name }) => ({ value: id, label: name }));
}

// Показывает сообщение в указанном блоке.
// Обычные сообщения исчезают сами, ошибки остаются, пока по ним не щёлкнуть.
function showMessage(target, text, type = 'info') {
  clearTimeout(messageTimers.get(target));
  target.textContent = text;
  target.className = type === 'error' ? 'notice notice--error' : 'notice';
  target.hidden = false;
  if (type !== 'error') {
    messageTimers.set(target, setTimeout(() => { target.hidden = true; }, 3000));
  }
}

function showNotice(text, type) {
  showMessage(els.notice, text, type);
}

function showSettingsMessage(text, type) {
  showMessage(els.settingsMessage, text, type);
}

// Русские окончания: 1 задача, 2 задачи, 5 задач
function pluralize(n, [one, few, many]) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

/* =========================================================
   Поиск, фильтры, сортировка
   ========================================================= */

function hasActiveFilters() {
  return Object.values(filters).some((value) => value.trim() !== '');
}

function matchesRef(value, filterValue) {
  if (!filterValue) return true;
  if (filterValue === NONE) return !value;
  return value === filterValue;
}

// Без срока — в конце
function compareDue(a, b) {
  if (a.dueDate === b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return a.dueDate < b.dueDate ? -1 : 1;
}

function comparePriority(a, b) {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

function compareTasks(a, b) {
  const result = data.settings.sort === 'priority'
    ? comparePriority(a, b) || compareDue(a, b)
    : compareDue(a, b) || comparePriority(a, b);
  // При равенстве — новые выше
  return result || b.createdAt.localeCompare(a.createdAt);
}

function getVisibleTasks() {
  const query = filters.search.trim().toLowerCase();
  return data.tasks
    .filter((task) =>
      (!query
        || task.title.toLowerCase().includes(query)
        || task.description.toLowerCase().includes(query))
      && matchesRef(task.directionId, filters.direction)
      && matchesRef(task.projectId, filters.project)
      && (!filters.priority || task.priority === filters.priority)
      && (!filters.status || task.status === filters.status))
    .sort(compareTasks);
}

// Варианты фильтров направлений/проектов меняются вместе с настройками
function refreshFilterOptions() {
  Object.entries(LISTS).forEach(([kind, cfg]) => {
    const select = kind === 'directions' ? els.filterDirection : els.filterProject;
    const filterKey = kind === 'directions' ? 'direction' : 'project';
    const options = [
      { value: '', label: cfg.allLabel },
      { value: NONE, label: cfg.emptyLabel },
      ...listToOptions(data[kind]),
    ];
    fillSelect(select, options);
    // Если выбранный вариант удалили — сбрасываем фильтр
    if (!options.some((o) => o.value === filters[filterKey])) filters[filterKey] = '';
    select.value = filters[filterKey];
  });
}

function resetFilters() {
  Object.keys(filters).forEach((key) => { filters[key] = ''; });
  els.search.value = '';
  els.filterPriority.value = '';
  els.filterStatus.value = '';
  render();
}

/* =========================================================
   Отрисовка
   ========================================================= */

function render() {
  refreshFilterOptions();
  updateViewSwitch();

  const visible = getVisibleTasks();
  const total = data.tasks.length;
  const isBoard = data.settings.view === 'board';
  const filtered = hasActiveFilters();

  // Счётчик в шапке
  const doneCount = data.tasks.filter((t) => t.status === 'done').length;
  const overdueCount = data.tasks.filter((t) => getDueState(t) === 'overdue').length;
  const parts = [];
  if (total) parts.push(`Всего: ${total}`, `Готово: ${doneCount}`);
  if (overdueCount) parts.push(`Просрочено: ${overdueCount}`);
  els.counter.textContent = parts.join(' · ');

  // Строка «Найдено: X из Y»
  els.summaryRow.hidden = !filtered;
  els.summary.textContent = `Найдено: ${visible.length} из ${total}`;

  // Пустое состояние
  const nothing = visible.length === 0;
  els.empty.hidden = !nothing;
  if (nothing) {
    const noTasksAtAll = total === 0;
    els.emptyTitle.textContent = noTasksAtAll ? 'Задач пока нет' : 'Ничего не найдено';
    els.emptyText.textContent = noTasksAtAll
      ? 'Нажмите «+ Новая задача», чтобы добавить первую.'
      : 'Попробуйте изменить поиск или фильтры.';
    els.emptyResetBtn.hidden = noTasksAtAll;
  }

  els.list.hidden = nothing || isBoard;
  els.board.hidden = nothing || !isBoard;

  if (nothing) return;
  if (isBoard) renderBoard(visible);
  else renderList(visible);
}

function updateViewSwitch() {
  els.viewButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === data.settings.view));
  });
}

/* ----- Общие части карточек ----- */

function taskClasses(base, task) {
  const classes = [base];
  if (task.status === 'done') classes.push(`${base}--done`);
  const dueState = getDueState(task);
  if (dueState) classes.push(`${base}--${dueState}`);
  return classes.join(' ');
}

function createBadge(task) {
  return el('span', `badge badge--${task.priority}`, PRIORITIES[task.priority]);
}

function createTitleButton(task) {
  const button = el('button', 'task__title', task.title);
  button.type = 'button';
  button.title = 'Открыть задачу';
  button.addEventListener('click', () => openTaskDialog(task.id));
  return button;
}

function createMeta(task) {
  const meta = el('ul', 'task__meta');

  if (task.dueDate) {
    const dueState = getDueState(task);
    let label = `Срок: ${formatDate(task.dueDate)}`;
    if (dueState === 'overdue') label = `Просрочено: ${formatDate(task.dueDate)}`;
    if (dueState === 'today') label = 'Срок: сегодня';
    meta.append(el('li', dueState ? `chip chip--${dueState}` : 'chip', label));
  }

  const projectName = findName(data.projects, task.projectId);
  if (projectName) meta.append(el('li', 'chip', projectName));
  const directionName = findName(data.directions, task.directionId);
  if (directionName) meta.append(el('li', 'chip', directionName));

  return meta.children.length ? meta : null;
}

function createStatusSelect(task, className) {
  const select = el('select', `input ${className}`);
  select.setAttribute('aria-label', 'Статус задачи');
  fillSelect(select, dictToOptions(STATUSES));
  select.value = task.status;
  select.addEventListener('change', () => changeTaskStatus(task.id, select.value));
  return select;
}

/* ----- Вид «Список» ----- */

function renderList(tasks) {
  // Выполненные — в конце (сортировка в JS устойчивая, порядок остальных сохраняется)
  const ordered = [...tasks].sort((a, b) => (a.status === 'done') - (b.status === 'done'));
  els.list.replaceChildren(...ordered.map(createListItem));
}

function createListItem(task) {
  const item = el('li', taskClasses('task', task));

  // Левая часть: приоритет, название, описание, метки
  const main = el('div', 'task__main');
  const header = el('div', 'task__header');
  header.append(createBadge(task), createTitleButton(task));
  main.append(header);
  if (task.description) main.append(el('p', 'task__description', task.description));
  const meta = createMeta(task);
  if (meta) main.append(meta);

  // Правая часть: статус и кнопки
  const actions = el('div', 'task__actions');

  const editBtn = el('button', 'btn btn--small', 'Изменить');
  editBtn.type = 'button';
  editBtn.addEventListener('click', () => openTaskDialog(task.id));

  const deleteBtn = el('button', 'btn btn--small btn--danger', 'Удалить');
  deleteBtn.type = 'button';
  deleteBtn.addEventListener('click', () => deleteTask(task.id));

  actions.append(createStatusSelect(task, 'task__status'), editBtn, deleteBtn);
  item.append(main, actions);
  return item;
}

/* ----- Вид «Доска» ----- */

function renderBoard(tasks) {
  const columns = Object.entries(STATUSES).map(([status, label]) => {
    const columnTasks = tasks.filter((t) => t.status === status);

    const column = el('section', 'board__column');
    column.dataset.status = status;

    const header = el('header', 'board__header');
    header.append(el('h2', 'board__title', label), el('span', 'board__count', String(columnTasks.length)));

    const cards = el('ul', 'board__cards');
    if (columnTasks.length) cards.append(...columnTasks.map(createBoardCard));
    else cards.append(el('li', 'board__empty', 'Нет задач'));

    column.append(header, cards);
    addDropHandlers(column, status);
    return column;
  });
  els.board.replaceChildren(...columns);
}

function createBoardCard(task) {
  const card = el('li', taskClasses('card', task));
  card.draggable = true;

  const header = el('div', 'card__header');
  header.append(createBadge(task), createTitleButton(task));
  card.append(header);

  const meta = createMeta(task);
  if (meta) card.append(meta);

  // Меню статуса — для телефона и для тех, кому неудобно перетаскивать
  card.append(createStatusSelect(task, 'card__status'));

  card.addEventListener('dragstart', (event) => {
    draggedTaskId = task.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    card.classList.add('card--dragging');
  });
  card.addEventListener('dragend', () => {
    draggedTaskId = null;
    card.classList.remove('card--dragging');
    els.board.querySelectorAll('.board__column--over')
      .forEach((col) => col.classList.remove('board__column--over'));
  });

  return card;
}

function addDropHandlers(column, status) {
  column.addEventListener('dragover', (event) => {
    if (!draggedTaskId) return;
    event.preventDefault(); // разрешаем «бросить» карточку сюда
    event.dataTransfer.dropEffect = 'move';
    column.classList.add('board__column--over');
  });
  column.addEventListener('dragleave', (event) => {
    if (!column.contains(event.relatedTarget)) column.classList.remove('board__column--over');
  });
  column.addEventListener('drop', (event) => {
    event.preventDefault();
    column.classList.remove('board__column--over');
    const taskId = draggedTaskId;
    draggedTaskId = null;
    if (taskId) changeTaskStatus(taskId, status);
  });
}

function setView(view) {
  if (!VIEWS.includes(view) || data.settings.view === view) return;
  data.settings.view = view;
  saveData();
  render();
}

/* =========================================================
   Действия с задачами
   ========================================================= */

function openTaskDialog(taskId = null) {
  const task = taskId ? data.tasks.find((t) => t.id === taskId) : null;
  editingTaskId = task ? task.id : null;
  const f = els.fields;

  // Списки проектов и направлений берём свежие — они могут меняться
  fillSelect(f.project, listToOptions(data.projects), LISTS.projects.emptyLabel);
  fillSelect(f.direction, listToOptions(data.directions), LISTS.directions.emptyLabel);

  els.dialogTitle.textContent = task ? 'Редактировать задачу' : 'Новая задача';
  f.title.value = task ? task.title : '';
  f.description.value = task ? task.description : '';
  f.dueDate.value = task && task.dueDate ? task.dueDate : '';
  f.priority.value = task ? task.priority : 'medium';
  f.status.value = task ? task.status : 'todo';
  f.project.value = task && findName(data.projects, task.projectId) ? task.projectId : '';
  f.direction.value = task && findName(data.directions, task.directionId) ? task.directionId : '';
  els.deleteBtn.hidden = !task;

  els.dialog.showModal();
  f.title.focus();
}

function closeTaskDialog() {
  els.dialog.close();
  editingTaskId = null;
}

function handleFormSubmit(event) {
  event.preventDefault();
  const f = els.fields;

  const title = f.title.value.trim();
  if (!title) {
    f.title.value = '';
    f.title.reportValidity(); // браузер покажет подсказку «Заполните это поле»
    return;
  }

  const values = {
    title,
    description: f.description.value.trim(),
    dueDate: f.dueDate.value || null,
    priority: f.priority.value,
    status: f.status.value,
    projectId: f.project.value || null,
    directionId: f.direction.value || null,
  };
  const now = new Date().toISOString();

  const existing = editingTaskId ? data.tasks.find((t) => t.id === editingTaskId) : null;
  if (existing) {
    Object.assign(existing, values, { updatedAt: now });
  } else {
    data.tasks.push({ id: generateId('t'), ...values, createdAt: now, updatedAt: now });
  }

  if (saveData()) showNotice(existing ? 'Задача сохранена' : 'Задача добавлена');
  render();
  closeTaskDialog();
}

function changeTaskStatus(taskId, status) {
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task || !(status in STATUSES) || task.status === status) return;
  task.status = status;
  task.updatedAt = new Date().toISOString();
  saveData();
  render();
}

// Возвращает true, если задача удалена
function deleteTask(taskId) {
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task) return false;
  if (!confirm(`Удалить задачу «${task.title}»?\nЭто действие нельзя отменить.`)) return false;

  data.tasks = data.tasks.filter((t) => t.id !== taskId);
  if (saveData()) showNotice('Задача удалена');
  render();
  return true;
}

/* =========================================================
   Настройки: направления и проекты
   ========================================================= */

function countTasksUsing(kind, itemId) {
  const field = LISTS[kind].taskField;
  return data.tasks.filter((t) => t[field] === itemId).length;
}

// Есть ли уже такое название (без учёта регистра букв)
function nameExists(kind, name, exceptId = null) {
  const lower = name.toLowerCase();
  return data[kind].some((item) => item.id !== exceptId && item.name.toLowerCase() === lower);
}

function openSettings() {
  els.settingsMessage.hidden = true;
  renderSettings();
  els.settingsDialog.showModal();
}

function renderSettings() {
  Object.keys(LISTS).forEach(renderSettingsList);
  els.themeSelect.value = data.settings.theme;
}

function renderSettingsList(kind) {
  const listEl = els.settingsLists[kind];
  if (!data[kind].length) {
    listEl.replaceChildren(el('li', 'settings-empty', 'Список пуст'));
    return;
  }
  listEl.replaceChildren(...data[kind].map((item) => createSettingsItem(kind, item)));
}

function createSettingsItem(kind, item) {
  const li = el('li', 'settings-item');

  // Название можно править прямо в поле; сохраняется при выходе из поля или Enter
  const input = el('input', 'input settings-item__name');
  input.type = 'text';
  input.maxLength = 60;
  input.value = item.name;
  input.setAttribute('aria-label', `Название: ${item.name}`);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
  });
  input.addEventListener('change', () => renameListItem(kind, item.id, input));

  const used = countTasksUsing(kind, item.id);
  const count = el(
    'span',
    'settings-item__count',
    used ? `${used} ${pluralize(used, ['задача', 'задачи', 'задач'])}` : 'нет задач',
  );

  const deleteBtn = el('button', 'btn btn--small btn--danger', 'Удалить');
  deleteBtn.type = 'button';
  deleteBtn.addEventListener('click', () => deleteListItem(kind, item.id));

  li.append(input, count, deleteBtn);
  return li;
}

function addListItem(kind, input) {
  const name = input.value.trim();
  if (!name) {
    input.value = '';
    input.focus();
    return;
  }
  if (nameExists(kind, name)) {
    showSettingsMessage(`«${name}» уже есть в списке`, 'error');
    input.focus();
    return;
  }

  data[kind].push({ id: generateId(LISTS[kind].prefix), name });
  if (saveData()) showSettingsMessage(`Добавлено: «${name}»`);
  renderSettingsList(kind);
  render();
  input.value = '';
  input.focus();
}

function renameListItem(kind, itemId, input) {
  const item = data[kind].find((entry) => entry.id === itemId);
  if (!item) return;
  const name = input.value.trim();

  if (!name) {
    input.value = item.name;
    showSettingsMessage('Название не может быть пустым', 'error');
    return;
  }
  if (name === item.name) {
    input.value = name;
    return;
  }
  if (nameExists(kind, name, itemId)) {
    input.value = item.name;
    showSettingsMessage(`«${name}» уже есть в списке`, 'error');
    return;
  }

  item.name = name;
  input.value = name;
  input.setAttribute('aria-label', `Название: ${name}`);
  if (saveData()) showSettingsMessage('Название сохранено');
  render();
}

function deleteListItem(kind, itemId) {
  const cfg = LISTS[kind];
  const item = data[kind].find((entry) => entry.id === itemId);
  if (!item) return;

  const used = countTasksUsing(kind, itemId);
  let question = `Удалить ${cfg.noun} «${item.name}»?`;
  if (used) {
    question += `\n\nЗадач с ним: ${used}. Сами задачи не удалятся, у них станет «${cfg.emptyLabel}».`;
  }
  if (!confirm(question)) return;

  data[kind] = data[kind].filter((entry) => entry.id !== itemId);
  const now = new Date().toISOString();
  data.tasks.forEach((task) => {
    if (task[cfg.taskField] === itemId) {
      task[cfg.taskField] = null;
      task.updatedAt = now;
    }
  });

  if (saveData()) showSettingsMessage(`Удалено: «${item.name}»`);
  renderSettingsList(kind);
  render();
}

/* =========================================================
   Тема оформления
   ========================================================= */

function applyTheme() {
  const theme = data.settings.theme;
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme; // как в системе
  }
}

function setTheme(theme) {
  if (!(theme in THEMES)) return;
  data.settings.theme = theme;
  saveData();
  applyTheme();
}

/* =========================================================
   Резервная копия
   ========================================================= */

function exportBackup() {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `task-tracker-backup-${todayISO()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  showSettingsMessage('Резервная копия скачана. Сохраните файл в надёжном месте.');
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();

  reader.onload = () => {
    let imported;
    try {
      const raw = JSON.parse(reader.result);
      if (!raw || !Array.isArray(raw.tasks)) throw new Error('Нет списка задач');
      imported = normalizeData(raw);
    } catch (error) {
      showSettingsMessage('Не получилось прочитать файл. Выберите файл резервной копии Task Tracker (.json).', 'error');
      return;
    }

    const question = `Загрузить резервную копию «${file.name}»?\n\n`
      + `Задач в копии: ${imported.tasks.length}. Задач сейчас: ${data.tasks.length}.\n`
      + 'Текущие данные будут заменены данными из файла.';
    if (!confirm(question)) return;

    data = imported;
    const saved = saveData();
    applyTheme();
    renderSettings();
    render();
    if (saved) showSettingsMessage(`Копия загружена. Задач: ${imported.tasks.length}.`);
  };

  reader.onerror = () => showSettingsMessage('Не удалось открыть файл.', 'error');
  reader.readAsText(file);
}

/* =========================================================
   Запуск
   ========================================================= */

function bindEvents() {
  // Задачи
  els.addBtn.addEventListener('click', () => openTaskDialog());
  els.form.addEventListener('submit', handleFormSubmit);
  els.cancelBtn.addEventListener('click', closeTaskDialog);
  els.deleteBtn.addEventListener('click', () => {
    if (deleteTask(editingTaskId)) closeTaskDialog();
  });
  els.dialog.addEventListener('close', () => { editingTaskId = null; });
  // Щелчок по затемнённому фону закрывает окно
  els.dialog.addEventListener('click', (event) => {
    if (event.target === els.dialog) closeTaskDialog();
  });
  els.notice.addEventListener('click', () => { els.notice.hidden = true; });

  // Поиск, фильтры, сортировка, вид
  els.search.addEventListener('input', () => {
    filters.search = els.search.value;
    render();
  });
  [
    [els.filterDirection, 'direction'],
    [els.filterProject, 'project'],
    [els.filterPriority, 'priority'],
    [els.filterStatus, 'status'],
  ].forEach(([select, key]) => {
    select.addEventListener('change', () => {
      filters[key] = select.value;
      render();
    });
  });
  els.sortSelect.addEventListener('change', () => {
    data.settings.sort = els.sortSelect.value;
    saveData();
    render();
  });
  els.resetFiltersBtn.addEventListener('click', resetFilters);
  els.emptyResetBtn.addEventListener('click', resetFilters);
  els.viewButtons.forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  // Настройки
  els.settingsBtn.addEventListener('click', openSettings);
  els.settingsCloseBtn.addEventListener('click', () => els.settingsDialog.close());
  els.settingsDialog.addEventListener('click', (event) => {
    if (event.target === els.settingsDialog) els.settingsDialog.close();
  });
  els.settingsMessage.addEventListener('click', () => { els.settingsMessage.hidden = true; });
  els.settingsAddForms.forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      addListItem(form.dataset.kind, form.querySelector('input'));
    });
  });
  els.themeSelect.addEventListener('change', () => setTheme(els.themeSelect.value));
  els.exportBtn.addEventListener('click', exportBackup);
  els.importBtn.addEventListener('click', () => els.importInput.click());
  els.importInput.addEventListener('change', () => {
    importBackup(els.importInput.files[0]);
    els.importInput.value = ''; // чтобы можно было выбрать тот же файл ещё раз
  });

  // Если трекер открыт в двух вкладках — подхватываем изменения из другой
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    data = loadData();
    applyTheme();
    els.sortSelect.value = data.settings.sort;
    render();
    if (els.settingsDialog.open) renderSettings();
  });

  // Подсветка «сегодня/просрочено» обновляется, когда вкладку снова открывают
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  });
}

function init() {
  data = loadData();
  applyTheme();

  // Неизменные варианты выпадающих списков
  fillSelect(els.fields.priority, dictToOptions(PRIORITIES));
  fillSelect(els.fields.status, dictToOptions(STATUSES));
  fillSelect(els.filterPriority, dictToOptions(PRIORITIES), 'Любой приоритет');
  fillSelect(els.filterStatus, dictToOptions(STATUSES), 'Любой статус');
  fillSelect(els.sortSelect, dictToOptions(SORTS));
  fillSelect(els.themeSelect, dictToOptions(THEMES));
  els.sortSelect.value = data.settings.sort;

  bindEvents();
  render();
}

init();
