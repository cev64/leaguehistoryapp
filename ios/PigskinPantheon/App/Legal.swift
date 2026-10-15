import Foundation

/// The legal pages and contact App Review (and members) need to reach from
/// inside the app. The pages live on the website.
enum Legal {
    static let site = URL(string: "https://pigskinpantheon.com")!
    static let privacy = URL(string: "https://pigskinpantheon.com/privacy.html")!
    static let terms = URL(string: "https://pigskinpantheon.com/terms.html")!
    static let support = URL(string: "https://pigskinpantheon.com/support.html")!
    static let supportEmail = "support@pigskinpantheon.com"

    /// Who isn't behind the app: shown in the footer and the account screen.
    static let disclaimer = "Not affiliated with or endorsed by Sleeper, ESPN, the NFL or the NFLPA."

    /// Who answers Ask the League (league-chat), named before the first question.
    static let aiProviders = "Google Gemini, with Anthropic Claude as a backup"

    /// What Google may do with it, said in the consent sheet: the app uses
    /// Gemini's free tier, and Google's terms for unpaid services let it use
    /// what it's sent (the privacy policy's "Ask the League" section).
    static let aiTraining = "On Gemini's free tier, Google may also use it to improve its products."
}
