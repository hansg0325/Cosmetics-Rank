import type { CategoryLeader } from "../shared/dashboardLeaders";
import { params, useData } from "./analyticsApi";
import type { OpenProduct } from "./RankingsPanel";

export function DashboardPanel({
  onProduct,
  revision,
}: {
  onProduct: OpenProduct;
  revision: string;
}) {
  const data = useData<CategoryLeader[]>(
    "dashboard/leaders?" + params({ v: revision }),
  );
  const leaders = data.data || [];
  function movement(row: CategoryLeader) {
    if (!row.product)
      return <span className="movement movement-UNCOMPARED">—</span>;
    if (!row.compared_to)
      return <span className="movement movement-UNCOMPARED">비교 없음</span>;
    const previous = row.product.previous_rank;
    if (previous == null)
      return <span className="movement movement-NEW">NEW</span>;
    return previous === 1 ? (
      <span className="movement movement-SAME">—</span>
    ) : (
      <span className="movement movement-UP">▲ {previous - 1}</span>
    );
  }
  return (
    <section className="dashboard-overview">
      <div className="dashboard-intro">
        <div>
          <h2>카테고리별 1위</h2>
        </div>
      </div>
      {data.loading && <p role="status">카테고리별 1위를 불러오는 중…</p>}
      {data.error && <p role="alert">{data.error}</p>}
      {leaders.length > 0 && (
        <article className="dashboard-leaders-panel">
          <div className="table-wrap">
            <table className="dashboard-leaders-table">
              <thead>
                <tr>
                  <th>순위</th>
                  <th>순위변동</th>
                  <th>브랜드</th>
                  <th>카테고리</th>
                  <th>상품명</th>
                </tr>
              </thead>
              <tbody>
                {leaders.map((row) => (
                  <tr key={row.category}>
                    <td>{row.product ? 1 : "—"}</td>
                    <td
                      title={
                        row.compared_to
                          ? `${row.compared_to} 대비 · 이전 순위 ${row.product?.previous_rank ?? "100위권 밖"}`
                          : "이전 비교 기록 없음"
                      }
                    >
                      {movement(row)}
                    </td>
                    <td>{row.product?.brand_name_at_capture || "—"}</td>
                    <td>
                      <span className="leader-category-name">
                        {row.name === "전체" ? "전체 랭킹" : row.name}
                      </span>
                    </td>
                    <td>
                      {row.product ? (
                        <button
                          className="text-link"
                          onClick={() =>
                            onProduct(row.product!.product_id, row.category)
                          }
                        >
                          {row.product.product_name_at_capture}
                        </button>
                      ) : (
                        <span className="leader-table-empty">
                          아직 수집된 랭킹이 없습니다.
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  );
}
