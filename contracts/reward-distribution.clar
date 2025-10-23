(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-INVALID-MILESTONE u102)
(define-constant ERR-INVALID-USER u103)
(define-constant ERR-INSUFFICIENT-BALANCE u104)
(define-constant ERR-MILESTONE-ALREADY-CLAIMED u105)
(define-constant ERR-INVALID-REWARD-TYPE u106)
(define-constant ERR-CONTRACT-DISABLED u107)
(define-constant ERR-INVALID-TIMESTAMP u108)
(define-constant ERR-INSUFFICIENT-TREASURY u109)
(define-constant ERR-INVALID-REWARD-RATE u110)
(define-constant ERR-INVALID-CONFIG u111)
(define-constant ERR-INVALID-TOKEN u112)

(define-data-var contract-enabled bool true)
(define-data-var treasury-balance uint u1000000)
(define-data-var reward-rate uint u100)
(define-data-var total-claims uint u0)
(define-data-var admin principal tx-sender)
(define-data-var token-contract (optional principal) none)

(define-map user-milestones 
  { user: principal, milestone-id: uint } 
  { claimed: bool, timestamp: uint }
)

(define-map milestone-configs
  uint
  { reward-amount: uint, required-points: uint, reward-type: (string-utf8 20) }
)

(define-map user-points
  principal
  uint
)

(define-read-only (get-treasury-balance)
  (ok (var-get treasury-balance))
)

(define-read-only (get-reward-rate)
  (ok (var-get reward-rate))
)

(define-read-only (get-total-claims)
  (ok (var-get total-claims))
)

(define-read-only (get-user-points (user principal))
  (ok (default-to u0 (map-get? user-points user)))
)

(define-read-only (get-milestone-config (milestone-id uint))
  (ok (map-get? milestone-configs milestone-id))
)

(define-read-only (get-user-milestone (user principal) (milestone-id uint))
  (ok (map-get? user-milestones { user: user, milestone-id: milestone-id }))
)

(define-private (validate-amount (amount uint))
  (if (> amount u0)
      (ok true)
      (err ERR-INVALID-AMOUNT))
)

(define-private (validate-milestone (milestone-id uint))
  (if (is-some (map-get? milestone-configs milestone-id))
      (ok true)
      (err ERR-INVALID-MILESTONE))
)

(define-private (validate-user (user principal))
  (if (not (is-eq user 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-INVALID-USER))
)

(define-private (validate-reward-type (reward-type (string-utf8 20)))
  (if (or (is-eq reward-type u"learn") (is-eq reward-type u"contribute") (is-eq reward-type u"verify"))
      (ok true)
      (err ERR-INVALID-REWARD-TYPE))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-public (set-token-contract (contract-principal principal))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-none (var-get token-contract)) (err ERR-INVALID-CONFIG))
    (var-set token-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-reward-rate (new-rate uint))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-rate u0) (err ERR-INVALID-REWARD-RATE))
    (var-set reward-rate new-rate)
    (ok true)
  )
)

(define-public (toggle-contract-enabled)
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (var-set contract-enabled (not (var-get contract-enabled)))
    (ok true)
  )
)

(define-public (add-milestone-config (milestone-id uint) (reward-amount uint) (required-points uint) (reward-type (string-utf8 20)))
  (begin
    (asserts! (is-eq tx-sender (var-get admin)) (err ERR-NOT-AUTHORIZED))
    (try! (validate-amount reward-amount))
    (try! (validate-amount required-points))
    (try! (validate-reward-type reward-type))
    (asserts! (is-none (map-get? milestone-configs milestone-id)) (err ERR-INVALID-MILESTONE))
    (map-set milestone-configs milestone-id { reward-amount: reward-amount, required-points: required-points, reward-type: reward-type })
    (ok true)
  )
)

(define-public (update-user-points (user principal) (points uint))
  (begin
    (asserts! (is-some (var-get token-contract)) (err ERR-INVALID-TOKEN))
    (try! (validate-user user))
    (try! (validate-amount points))
    (map-set user-points user (+ (default-to u0 (map-get? user-points user)) points))
    (ok true)
  )
)

(define-public (claim-reward (milestone-id uint))
  (let (
      (user tx-sender)
      (milestone (unwrap! (map-get? milestone-configs milestone-id) (err ERR-INVALID-MILESTONE)))
      (user-points (default-to u0 (map-get? user-points user)))
      (user-milestone (default-to { claimed: false, timestamp: u0 } (map-get? user-milestones { user: user, milestone-id: milestone-id })))
      (reward-amount (get reward-amount milestone))
      (required-points (get required-points milestone))
      (token (unwrap! (var-get token-contract) (err ERR-INVALID-TOKEN)))
    )
    (asserts! (var-get contract-enabled) (err ERR-CONTRACT-DISABLED))
    (try! (validate-user user))
    (try! (validate-milestone milestone-id))
    (asserts! (not (get claimed user-milestone)) (err ERR-MILESTONE-ALREADY-CLAIMED))
    (asserts! (>= user-points required-points) (err ERR-INVALID-AMOUNT))
    (asserts! (>= (var-get treasury-balance) reward-amount) (err ERR-INSUFFICIENT-TREASURY))
    (try! (validate-timestamp block-height))
    (try! (as-contract (contract-call? token transfer reward-amount (as-contract tx-sender) user none)))
    (var-set treasury-balance (- (var-get treasury-balance) reward-amount))
    (var-set total-claims (+ (var-get total-claims) u1))
    (map-set user-milestones { user: user, milestone-id: milestone-id } { claimed: true, timestamp: block-height })
    (map-set user-points user (- user-points required-points))
    (print { event: "reward-claimed", user: user, milestone-id: milestone-id, amount: reward-amount })
    (ok true)
  )
)