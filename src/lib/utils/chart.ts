import { ChartJSNodeCanvas } from 'chartjs-node-canvas';

const WIDTH = 640;
const HEIGHT = 480;

const chartCanvas = new ChartJSNodeCanvas({ width: WIDTH, height: HEIGHT, backgroundColour: 'white' });

const PALETTE = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc949',
  '#af7aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ab',
];

export interface PieSlice {
  label: string;
  value: number;
}

export async function renderPieChart(title: string, slices: PieSlice[]): Promise<Buffer> {
  return chartCanvas.renderToBuffer({
    type: 'pie',
    data: {
      labels: slices.map((s) => s.label),
      datasets: [
        {
          data: slices.map((s) => s.value),
          backgroundColor: slices.map((_, i) => PALETTE[i % PALETTE.length]),
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: title, font: { size: 18 } },
        legend: { position: 'bottom' },
      },
    },
  });
}
