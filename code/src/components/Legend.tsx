import { EDGE_COLORS } from "../types";

export function Legend() {
  return (
    <div className="legend">
      <span className="legend-item">
        <span className="swatch" style={{ background: EDGE_COLORS.automated }} />
        automated
      </span>
      <span className="legend-item">
        <span className="swatch" style={{ background: EDGE_COLORS.clean }} />
        clean path
      </span>
      <span className="legend-item">
        <span className="swatch" style={{ background: EDGE_COLORS.person }} />
        needs a person
      </span>
    </div>
  );
}
