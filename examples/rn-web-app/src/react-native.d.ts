// Type shim for `react-native` imports that get aliased to
// `react-native-web` at bundle time (see vite.config.ts). `react-native-web`
// itself doesn't ship .d.ts files, and `@types/react-native` is for the
// native runtime — pulling that in here introduces type divergence from
// what RN Web actually does in the DOM. The minimal local declarations
// below cover the components this example uses (View / Text / TextInput /
// Pressable) with permissive `style` props matching RN Web's runtime
// behaviour. Extend as the example grows.

declare module 'react-native' {
  import type { ComponentType, ReactNode } from 'react';

  type Style = Record<string, unknown> | Style[] | false | null | undefined;

  interface ViewProps {
    style?: Style;
    children?: ReactNode;
    accessibilityRole?: string;
    accessibilityLabel?: string;
  }
  interface TextProps extends ViewProps {}
  interface PressableProps extends ViewProps {
    onPress?: () => void;
  }
  interface TextInputProps {
    style?: Style;
    value?: string;
    placeholder?: string;
    onChangeText?: (text: string) => void;
    onSubmitEditing?: () => void;
    accessibilityLabel?: string;
  }

  export const View: ComponentType<ViewProps>;
  export const Text: ComponentType<TextProps>;
  export const Pressable: ComponentType<PressableProps>;
  export const TextInput: ComponentType<TextInputProps>;
}
