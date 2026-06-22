import { Tooltip } from 'antd';
import type { TooltipProps } from 'antd';
import type { ReactElement, ReactNode } from 'react';

const ICON_TOOLTIP_Z_INDEX = 4000;

interface IconTooltipProps {
  title: ReactNode;
  placement?: TooltipProps['placement'];
  className?: string;
  children: ReactElement;
}

export default function IconTooltip({
  title,
  placement = 'bottom',
  className,
  children,
}: IconTooltipProps) {
  return (
    <Tooltip
      title={title}
      placement={placement}
      zIndex={ICON_TOOLTIP_Z_INDEX}
      getPopupContainer={() => document.body}
      destroyOnHidden
    >
      <span className={['icon-tooltip-trigger', className].filter(Boolean).join(' ')}>
        {children}
      </span>
    </Tooltip>
  );
}
