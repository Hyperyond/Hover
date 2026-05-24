// Plain DOM wiring — no UI framework. Purely a smoke target for the
// agent: the controls are accessible by role/name, the values are easy
// to assert against, and the page contains no SSR'd state that would
// interfere with the widget's snapshot.

const countEl = document.getElementById('count');
let count = 0;
function setCount(n) {
  count = n;
  countEl.textContent = String(n);
}
document.getElementById('inc').addEventListener('click', () => setCount(count + 1));
document.getElementById('reset').addEventListener('click', () => setCount(0));

const list = document.getElementById('todo-list');
const input = document.getElementById('todo-input');
document.getElementById('todo-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const li = document.createElement('li');
  li.textContent = text;
  list.appendChild(li);
  input.value = '';
});
