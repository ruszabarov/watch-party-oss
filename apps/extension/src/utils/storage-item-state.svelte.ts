import { onMount } from 'svelte';
import type { WxtStorageItem } from '#imports';

export function useStorageItem<T>(item: WxtStorageItem<T, any>, fallback: T) {
  let current = $state(fallback);

  onMount(() => {
    let mounted = true;

    void item
      .getValue()
      .then((value) => {
        if (mounted) {
          current = value;
        }
      })
      .catch(() => undefined);

    const unwatch = item.watch((value) => {
      current = value;
    });

    return () => {
      mounted = false;
      unwatch();
    };
  });

  return {
    get current(): T {
      return current;
    },
    set current(value: T) {
      current = value;
      void item.setValue(value).catch(() => undefined);
    },
  };
}
