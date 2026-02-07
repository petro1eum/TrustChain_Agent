/**
 * Конфигурация агента
 */

export interface AgentConfig {
  maxIterations: number;
  maxThinkIterations: number;
  maxPlanIterations: number;
}

export const AGENT_CONFIG: AgentConfig = {
  maxIterations: 10,
  maxThinkIterations: 2000,
  maxPlanIterations: 5000
};

