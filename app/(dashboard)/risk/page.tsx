'use client'

export default function RiskPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Risk Analytics</h1>
        <p className="text-muted-foreground">Portfolio risk assessment and default probability</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">Portfolio Default Probability</p>
          <p className="text-3xl font-bold mt-2">2.3%</p>
          <p className="text-xs text-muted-foreground mt-1">Average across agents</p>
        </div>
        <div className="p-4 border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">Total Exposure</p>
          <p className="text-3xl font-bold mt-2">$1.2M</p>
          <p className="text-xs text-muted-foreground mt-1">Active credit lines</p>
        </div>
        <div className="p-4 border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">AAA Rated</p>
          <p className="text-3xl font-bold mt-2">45%</p>
          <p className="text-xs text-muted-foreground mt-1">Portfolio composition</p>
        </div>
        <div className="p-4 border border-border rounded-lg">
          <p className="text-xs text-muted-foreground">VaR (95%)</p>
          <p className="text-3xl font-bold mt-2">$28K</p>
          <p className="text-xs text-muted-foreground mt-1">Value at risk</p>
        </div>
      </div>

      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-4">Portfolio Risk Distribution</h3>
        <p className="text-sm text-muted-foreground">Risk ratings across your agent portfolio</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
          {['AAA', 'AA', 'A', 'BBB', 'BB'].map((rating) => (
            <div key={rating} className="p-3 bg-secondary/50 rounded text-center">
              <p className="font-bold">{rating}</p>
              <p className="text-xs text-muted-foreground mt-1">{Math.round(Math.random() * 20)}%</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
