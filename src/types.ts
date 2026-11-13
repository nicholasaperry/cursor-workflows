export interface WorkflowStep {
  title: string;
  prompt: string;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  description: string;
  importPath: string;
  cwd: string;
  steps: WorkflowStep[];
}
