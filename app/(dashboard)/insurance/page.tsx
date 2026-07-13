'use client'

export default function InsurancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Insurance Coverage</h1>
        <p className="text-muted-foreground">Credit default insurance and risk mitigation products</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-border rounded-lg p-6">
          <h3 className="font-bold text-lg mb-2">Default Protection Pool</h3>
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Capital:</span> $8.4M</p>
            <p><span className="text-muted-foreground">Utilization:</span> 42%</p>
            <p><span className="text-muted-foreground">APY:</span> 9.2%</p>
            <p><span className="text-muted-foreground">Underwriters:</span> 214</p>
          </div>
        </div>

        <div className="border border-border rounded-lg p-6">
          <h3 className="font-bold text-lg mb-2">Your Coverage</h3>
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Coverage Amount:</span> $500K</p>
            <p><span className="text-muted-foreground">Premium:</span> $4,200/year</p>
            <p><span className="text-muted-foreground">Status:</span> <span className="text-success">Active</span></p>
            <p><span className="text-muted-foreground">Renewal:</span> Dec 31, 2024</p>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg p-6">
        <h3 className="font-bold text-lg mb-4">Available Insurance Products</h3>
        <div className="space-y-3">
          {['Default Coverage', 'Operational Risk', 'Liquidation Protection', 'Smart Contract Insurance'].map((product) => (
            <div key={product} className="flex items-center justify-between p-3 bg-secondary/50 rounded">
              <span className="font-medium">{product}</span>
              <button className="text-xs px-3 py-1 rounded border border-border hover:bg-secondary">
                Learn more
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
