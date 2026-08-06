import { render } from 'preact';
import { Workspace } from './components/Workspace';
import { StrokeProvider } from './strokeStore';
import './style.css';

render(
  <StrokeProvider>
    <Workspace />
  </StrokeProvider>,
  document.getElementById('app')!,
);
