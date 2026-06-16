import { render } from 'preact';
import { Workspace } from './components/Workspace';
import './style.css';

render(<Workspace />, document.getElementById('app')!);
