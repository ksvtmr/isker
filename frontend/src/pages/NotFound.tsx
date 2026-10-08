import { EmptyState } from "@isker/design-system";
import { LinkButton } from "../components/RouterLink";

export function NotFound() {
  return (
    <main style={{ maxWidth: 560, margin: "15vh auto 0", padding: 16 }}>
      <EmptyState icon="search-x" title="Page not found" description="The page you are looking for doesn't exist or has moved." action={<LinkButton to="/dashboard">Go to dashboard</LinkButton>} />
    </main>
  );
}
