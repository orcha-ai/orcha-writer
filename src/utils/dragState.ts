const WORKSPACE_TREE_DRAGGING_CLASS = 'orcha-workspace-tree-dragging';

export function setWorkspaceTreeDragging(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle(WORKSPACE_TREE_DRAGGING_CLASS, active);
}

export function isWorkspaceTreeDragging(): boolean {
  if (typeof document === 'undefined') return false;
  return document.body.classList.contains(WORKSPACE_TREE_DRAGGING_CLASS);
}
