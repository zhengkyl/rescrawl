import { useRef, useEffect } from 'preact/hooks';
import { useApp } from '../context';
import { DEFAULT_CONFIG } from '../utils';

export function SettingsDialog() {
  const { config, setConfig, settingsOpen: open, setSettingsOpen } = useApp();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const onClose = () => setSettingsOpen(false);

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
            checked={config.sidebarRight}
            onChange={(e) => setConfig(c => ({ ...c, sidebarRight: (e.target as HTMLInputElement).checked }))}
          />
          {' '}Sidebar on right
        </label>
      </div>
      <div class="dialog-actions">
        <button type="button" id="btn-settings-reset" onClick={() => setConfig({ ...DEFAULT_CONFIG })}>Reset to defaults</button>
        <button type="button" id="settings-close" onClick={onClose}>Close</button>
      </div>
    </dialog>
  );
}
