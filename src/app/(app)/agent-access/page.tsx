import { KeysPanel } from '@/components/platform/KeysPanel';

/* /agent-access — MCP 令牌自助管理(所有登录用户;member 只见/只建自己的
   公司级令牌,平台管理员另有全租户视图)。原 设置 → Agent 接入 Tab 独立而来。 */
export default function AgentAccessPage() {
  return <KeysPanel />;
}
