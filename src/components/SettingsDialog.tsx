import { useRef, useEffect } from 'preact/hooks';

type Props = {
  open: boolean;
  onClose: () => void;
  sidebarRight: boolean;
  onSidebarRightChange: (v: boolean) => void;
  onReset: () => void;
};

export function SettingsDialog({ open, onClose, sidebarRight, onSidebarRightChange, onReset }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    if (open) dialog.showModal();
    else dialog.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} onClose={onClose}>
      <div class="dialog-field">
        <label class="check-row">
          <input
            type="checkbox"
            id="chk-sidebar-right"
            checked={sidebarRight}
            onChange={(e) => onSidebarRightChange((e.target as HTMLInputElement).checked)}
          />
          {' '}Sidebar on right
        </label>
      </div>
      <div class="dialog-actions">
        <button type="button" id="btn-settings-reset" onClick={onReset}>Reset to defaults</button>
        <button type="button" id="settings-close" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
