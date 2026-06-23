"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip
} from "chart.js";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

type BarChartProps = {
  labels: string[];
  values: number[];
  format?: "money" | "number" | "miles" | "percent";
};

function formatValue(value: number, format: BarChartProps["format"]): string {
  if (format === "money") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  }
  if (format === "miles") {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} mi`;
  }
  if (format === "percent") {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function BarChart({ labels, values, format = "number" }: BarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const formatted = useMemo(() => (value: number) => formatValue(value, format), [format]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const styles = getComputedStyle(document.documentElement);
    const ink = styles.getPropertyValue("--ink").trim();
    const muted = styles.getPropertyValue("--muted").trim();
    const brand = styles.getPropertyValue("--brand").trim();
    const line = styles.getPropertyValue("--line").trim();

    const chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: `rgb(${brand})`,
            borderRadius: 6,
            borderSkipped: false
          }
        ]
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => formatted(Number(item.raw ?? 0))
            }
          }
        },
        scales: {
          x: {
            ticks: { color: `rgb(${muted})`, maxRotation: 0, autoSkip: false },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: { color: `rgb(${muted})`, callback: (value) => formatted(Number(value)) },
            grid: { color: `rgb(${line})` }
          }
        },
        color: `rgb(${ink})`
      }
    });

    return () => chart.destroy();
  }, [format, formatted, labels, values]);

  if (!labels.length) {
    return <div className="flex h-64 items-center justify-center rounded border border-dashed border-line text-sm text-muted">No data available</div>;
  }

  return (
    <div className="h-64">
      <canvas ref={canvasRef} />
    </div>
  );
}
