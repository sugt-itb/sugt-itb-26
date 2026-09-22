import { Band } from "-/components/band";
import { ClusterCard } from "-/components/cluster-card";
import { DeliveryBand } from "-/components/delivery-band";
import { Stat } from "-/components/stat";
import { getDelivery, getScope } from "-/lib/aggregates";
import { clusterFigures, deliveryDenominator, hasDelivery, provinceCount } from "-/lib/figures";
import { CLASS_KINDS, STREAMS, TOTAL_SESSIONS_PER_SCHOOL } from "@sugt/domain";

/**
 * **Beranda — the landing page.**
 *
 * It **leads with scope, not delivery** (ADR-0001): four stats, of which only the first is fetched —
 * `47 Sekolah di 16 provinsi` from the scope payload, and then the three fixed figures that are
 * `@sugt/domain` constants both apps hold, never sent over the wire. The Clusters follow. The
 * **delivery band appears only once there is delivery to report**, so launch day is scope → Streams →
 * Clusters with no `0 Sesi terlaksana` gap, and the band arrives by itself after the first trip.
 *
 * Segment `revalidate` is the hour the delivery payload uses — the shortest of the two lifetimes this
 * page reads (scope is a day). Route-segment revalidate plus the fetch Data Cache is ADR-0014's
 * model; `cacheComponents` stays unset.
 */
export const revalidate = 3600;

export default async function Page() {
  const [scope, delivery] = await Promise.all([getScope(), getDelivery()]);
  const clusters = clusterFigures(scope, delivery);

  return (
    <>
      <Band className="py-16">
        <h1 className="max-w-3xl font-heading text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Sekolah Unggul Garuda Transformasi
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          STEM &amp; Research Track — dijalankan oleh DITSAMA ITB bersama Sekolah-Sekolah di seluruh
          Indonesia.
        </p>
      </Band>

      <Band>
        <div className="flex flex-wrap gap-x-12 gap-y-8">
          <Stat
            figure={scope.schools.length.toLocaleString("id-ID")}
            caption={`Sekolah di ${provinceCount(scope.schools).toLocaleString("id-ID")} provinsi`}
          />
          <Stat
            figure={STREAMS.length}
            caption="Stream"
          />
          <Stat
            figure={CLASS_KINDS.length}
            caption="Kelas per Sekolah"
          />
          <Stat
            figure={TOTAL_SESSIONS_PER_SCHOOL}
            caption="Sesi per Sekolah"
          />
        </div>
      </Band>

      <Band>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Cluster</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Empat Cluster, masing-masing menggarap satu Topik dan menjawab satu Masalah.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {clusters.map(({ cluster, schoolCount, delivered }) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              schoolCount={schoolCount}
              delivered={delivered}
            />
          ))}
        </div>
      </Band>

      {hasDelivery(delivery) && (
        <DeliveryBand
          deliveredTotal={delivery.deliveredTotal}
          denominator={deliveryDenominator(scope.schools.length)}
          clusters={clusters.map(({ cluster, delivered }) => ({ name: cluster.name, delivered }))}
        />
      )}
    </>
  );
}
