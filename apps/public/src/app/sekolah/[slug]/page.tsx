import { Band } from "-/components/band";
import { getScope } from "-/lib/aggregates";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@sugt/ui/components/breadcrumb";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

/**
 * **One School** — its identity and the Cluster it belongs to.
 *
 * Scope only, and deliberately so: ADR-0001 keeps every per-School **delivery** figure off the public
 * site (a School's own `0 of 8` is exactly the kind of figure it forbids), so this page carries a
 * School's name, where it is and which Cluster it works within, and no count of what it has done.
 * `generateStaticParams` prebuilds all forty-two from the scope payload; an unknown slug is a 404.
 */
export const revalidate = 86_400;

export async function generateStaticParams() {
  const scope = await getScope();
  return scope.schools.map((school) => ({ slug: school.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/sekolah/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const scope = await getScope();
  return { title: scope.schools.find((school) => school.slug === slug)?.name ?? "Sekolah" };
}

export default async function Page({ params }: PageProps<"/sekolah/[slug]">) {
  const { slug } = await params;
  const scope = await getScope();

  const school = scope.schools.find((entry) => entry.slug === slug);
  if (!school) notFound();

  const cluster = scope.clusters.find((entry) => entry.slug === school.clusterSlug);

  return (
    <Band className="py-16">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/program">Program</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{school.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-4 font-heading text-4xl font-bold tracking-tight">{school.name}</h1>
      <p className="mt-3 text-lg text-muted-foreground">
        {school.kabupatenKota}, {school.provinceName}
      </p>
      {cluster !== undefined && (
        <p className="mt-6 text-sm text-muted-foreground">
          Bagian dari Cluster{" "}
          <Link
            href={`/cluster/${cluster.slug}`}
            className="font-medium text-foreground hover:underline"
          >
            {cluster.name}
          </Link>
          .
        </p>
      )}
    </Band>
  );
}
