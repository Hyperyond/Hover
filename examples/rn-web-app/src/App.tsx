// React Native components imported here resolve to `react-native-web`'s
// DOM implementations via the Vite alias (see vite.config.ts). To the
// agent driving this page they look like ordinary HTML / ARIA controls —
// View → div, Text → div, TextInput → input, Pressable → button-like
// — which is exactly why Hover works at all for RN Web targets.
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

export default function App() {
  const [count, setCount] = useState(0);
  const [draft, setDraft] = useState('');
  const [todos, setTodos] = useState<string[]>([]);

  function addTodo(): void {
    const text = draft.trim();
    if (!text) return;
    setTodos(prev => [...prev, text]);
    setDraft('');
  }

  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.h1}>
        Hover · React Native Web
      </Text>
      <Text style={styles.p}>
        This is a React Native app compiled to the DOM via
        react-native-web. View / Text / TextInput / Pressable resolve to
        plain HTML, so Hover drives it just like any other Vite + React
        target.
      </Text>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.h2}>
          Counter
        </Text>
        <Text style={styles.p}>
          Count: <Text>{String(count)}</Text>
        </Text>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" style={styles.btn} onPress={() => setCount(c => c + 1)}>
            <Text style={styles.btnText}>+1</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.btn} onPress={() => setCount(0)}>
            <Text style={styles.btnText}>Reset</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.h2}>
          Todos
        </Text>
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="What needs doing?"
            placeholder="What needs doing?"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={addTodo}
            style={styles.input}
          />
          <Pressable accessibilityRole="button" style={styles.btn} onPress={addTodo}>
            <Text style={styles.btnText}>Add</Text>
          </Pressable>
        </View>
        <View>
          {todos.map((t, i) => (
            <Text key={i} style={styles.todoItem}>
              {t}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

// Plain object styles — react-native-web translates them to CSS at
// runtime. Deliberately verbose / explicit because RN style props don't
// inherit the way CSS does.
const styles = {
  page: { padding: 24, maxWidth: 640, marginHorizontal: 'auto', fontFamily: 'system-ui, sans-serif' },
  h1: { fontSize: 28, fontWeight: '700' as const, marginBottom: 8 },
  h2: { fontSize: 20, fontWeight: '600' as const, marginBottom: 12 },
  p: { fontSize: 14, color: '#444', marginBottom: 8 },
  section: { marginTop: 24, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#eee' },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 8 },
  input: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    fontSize: 14,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#1e293b',
    borderRadius: 4,
  },
  btnText: { color: 'white', fontSize: 14 },
  todoItem: { marginTop: 6, fontSize: 14 },
};
