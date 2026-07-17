// Task manager UI

export function initTasks() {
  const taskInput = document.getElementById('taskInput');
  const addTaskBtn = document.getElementById('addTaskBtn');
  const taskList = document.getElementById('taskList');
  const tasksCount = document.getElementById('tasksCount');

  function genId() {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 't' + Date.now() + Math.random().toString(36).slice(2);
  }

  function loadTasks() {
    chrome.storage.local.get({ tasks: [] }, (data) => {
      let changed = false;
      data.tasks.forEach(t => { if (!t.id) { t.id = genId(); changed = true; } });
      if (changed) chrome.storage.local.set({ tasks: data.tasks });
      renderTasks(data.tasks);
    });
  }

  function saveTasks(tasks) {
    chrome.storage.local.set({ tasks }, () => renderTasks(tasks));
  }

  function renderTasks(tasks) {
    taskList.innerHTML = '';
    const done = tasks.filter(t => t.done).length;
    tasksCount.textContent = `${done}/${tasks.length}`;

    if (tasks.length === 0) {
      taskList.innerHTML = '<li style="padding:10px;text-align:center;font-size:11px;color:var(--muted);font-style:italic;">No tasks yet</li>';
      return;
    }

    tasks.forEach((task) => {
      const li = document.createElement('li');
      li.className = `task-item ${task.done ? 'done' : ''}`;
      li.innerHTML = `
        <div class="task-checkbox ${task.done ? 'checked' : ''}" data-id="${task.id}"></div>
        <span class="task-text">${escapeHtml(task.text)}</span>
        <button class="task-delete" data-id="${task.id}">&times;</button>
      `;
      taskList.appendChild(li);
    });

    // Checkbox click
    taskList.querySelectorAll('.task-checkbox').forEach(cb => {
      cb.addEventListener('click', () => {
        const id = cb.dataset.id;
        chrome.storage.local.get({ tasks: [] }, (data) => {
          const task = data.tasks.find(t => String(t.id) === id);
          if (!task) return;
          task.done = !task.done;
          saveTasks(data.tasks);
        });
      });
    });

    // Delete click
    taskList.querySelectorAll('.task-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        chrome.storage.local.get({ tasks: [] }, (data) => {
          saveTasks(data.tasks.filter(t => String(t.id) !== id));
        });
      });
    });
  }

  function addTask() {
    const text = taskInput.value.trim();
    if (!text) return;
    chrome.storage.local.get({ tasks: [] }, (data) => {
      data.tasks.push({ id: genId(), text, done: false, createdAt: Date.now() });
      saveTasks(data.tasks);
      taskInput.value = '';
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  addTaskBtn.addEventListener('click', addTask);
  taskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
  });

  loadTasks();
}
