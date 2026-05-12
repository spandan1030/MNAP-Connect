export default function EnrollSuccessPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-5">
      <div className="text-center max-w-sm">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">You're enrolled!</h1>
        <p className="text-gray-500 text-sm leading-relaxed">
          Thank you for subscribing. You'll receive updates from <strong>M N Alankar Palace</strong> on WhatsApp based on your selected interests.
        </p>
        <p className="text-xs text-gray-400 mt-5">You can visit this page anytime to update your preferences.</p>
      </div>
    </div>
  )
}
