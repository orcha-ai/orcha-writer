import { useEffect } from 'react';

function isFeatureContextMenuTarget(target: Element | null): boolean {
  if (!target) return false;
  return Boolean(
    target.closest('.sidebar')
      || target.closest('.block-editor-shell')
      || target.closest('.context-menu')
      || target.closest('.block-context-menu')
      || target.closest('.slash-command-menu')
  );
}

export default function GlobalContextMenu() {
  useEffect(() => {
    const suppressUnhandledContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target instanceof Element ? event.target : null;
      if (isFeatureContextMenuTarget(target)) return;

      event.preventDefault();
    };

    document.addEventListener('contextmenu', suppressUnhandledContextMenu);
    return () => {
      document.removeEventListener('contextmenu', suppressUnhandledContextMenu);
    };
  }, []);

  return null;
}
