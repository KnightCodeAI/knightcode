import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import { useKeyboard, useRenderer } from "@opentui/react";

export type KeyboardLayerId =
  | "base"
  | "command"
  | "dialog"
  | "mention"
  | "onboarding";

type Responder = () => boolean;

type KeyboardLayerContextValue = {
  push: (id: KeyboardLayerId, responder?: Responder) => void;
  pop: (id: KeyboardLayerId) => void;
  isTopLayer: (id: KeyboardLayerId) => boolean;
  hasLayer: (id: KeyboardLayerId) => boolean;
  setResponder: (id: KeyboardLayerId, responder: Responder | null) => void;
};

const KeyboardLayerContext = createContext<KeyboardLayerContextValue | null>(
  null,
);

export function KeyboardLayerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [stack, setStack] = useState<KeyboardLayerId[]>(["base"]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const responders = useRef<Map<KeyboardLayerId, Responder>>(new Map());
  const renderer = useRenderer();

  const push = useCallback((id: KeyboardLayerId, responder?: Responder) => {
    if (responder) {
      responders.current.set(id, responder);
    }

    setStack((prev) => {
      if (prev.includes(id)) {
        return prev;
      }

      return [...prev, id];
    });
  }, []);

  const pop = useCallback((id: KeyboardLayerId) => {
    responders.current.delete(id);
    setStack((prev) => prev.filter((layer) => layer !== id));
  }, []);

  const isTopLayer = useCallback(
    (id: KeyboardLayerId) => {
      return stack.length === 0 || stack[stack.length - 1] === id;
    },
    [stack],
  );

  const hasLayer = useCallback(
    (id: KeyboardLayerId) => {
      return stack.includes(id);
    },
    [stack],
  );

  const setResponder = useCallback(
    (id: KeyboardLayerId, responder: Responder | null) => {
      if (responder) {
        responders.current.set(id, responder);
      } else {
        responders.current.delete(id);
      }
    },
    [],
  );

  useKeyboard((key) => {
    if (!key.ctrl || key.name !== "c") return;

    const currentStack = stackRef.current;
    for (let i = currentStack.length - 1; i >= 0; i--) {
      const layerId = currentStack[i]!;
      const responder = responders.current.get(layerId);
      if (responder && responder()) {
        return;
      }
    }

    renderer.destroy();
  });

  return (
    <KeyboardLayerContext.Provider
      value={{ push, pop, isTopLayer, hasLayer, setResponder }}
    >
      {children}
    </KeyboardLayerContext.Provider>
  );
}

export function useKeyboardLayer() {
  const context = useContext(KeyboardLayerContext);
  if (!context) {
    throw new Error(
      "useKeyboardLayer must be used within a KeyboardLayerProvider",
    );
  }
  return context;
}
