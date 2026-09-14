import { createRoot } from 'react-dom/client';
import WorkspaceGate from './workspace-gate';
import WorkSectionPageBridge from './work-section-page-bridge';
import './globals.css';

createRoot(document.getElementById('root')!).render(<><WorkspaceGate /><WorkSectionPageBridge /></>);
