<script setup lang="ts">
// Plain Vue 3 composition — no router, no pages/ directory needed. The
// agent's job here is to drive these controls; the page exists to give
// it a stable smoke target with a counter + todo list.
const count = ref(0);
const todos = ref<string[]>([]);
const draft = ref('');
function addTodo() {
  const text = draft.value.trim();
  if (!text) return;
  todos.value.push(text);
  draft.value = '';
}
</script>

<template>
  <main>
    <h1>Hover · Nuxt example</h1>
    <p>
      This is the Nuxt smoke target. Nuxt renders through Nitro, so the
      <code>vite-plugin-hover</code> path doesn't fully work here — the
      <code>@hover-dev/nuxt</code> module bridges via Nuxt's
      <code>app.head.script</code>.
    </p>

    <section>
      <h2>Counter</h2>
      <p>Count: <span>{{ count }}</span></p>
      <button @click="count++">+1</button>
      <button @click="count = 0">Reset</button>
    </section>

    <section>
      <h2>Todos</h2>
      <form @submit.prevent="addTodo">
        <input v-model="draft" type="text" placeholder="What needs doing?" />
        <button type="submit">Add</button>
      </form>
      <ul>
        <li v-for="(t, i) in todos" :key="i">{{ t }}</li>
      </ul>
    </section>
  </main>
</template>

<style>
body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; }
h1 { margin-bottom: 0.5rem; }
section { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; }
button { padding: 0.4rem 0.8rem; margin-right: 0.5rem; }
input { padding: 0.4rem; margin-right: 0.5rem; }
code { background: #f3f3f3; padding: 0.1rem 0.3rem; border-radius: 3px; }
li { margin: 0.2rem 0; }
</style>
