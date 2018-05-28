const GdprCrowdsale = artifacts.require('./GdprCrowdsale.sol')
const GdprCash = artifacts.require('./GdprCash.sol')

const assertThrows = require('./utils/assertThrows')
const timeTravel = require('./utils/timeTravel')

contract('GdprCrowdsale', accounts => {
    const now = new Date().getTime() / 1000
    const start = now
    const end = start + 1296000 // 15 days after start

    const SIGNIFICANT_AMOUNT = 1024

    const [
        owner,
        buyer,
        buyer2,
        buyer3,
        buyer4,
        buyer5,
        receiver,
        middleman
    ] = accounts

    let tokenContract
    let saleContract

    context('crowdsale', () => {
        const sendAmount = web3.toWei(1, 'ether')

        before(async () => {
            tokenContract = await GdprCash.new()
            saleContract = await GdprCrowdsale.new(start, end, tokenContract.address)
            await tokenContract.setCrowdsale(saleContract.address)
        })

        it('deployed with the right ownership', async () => {
            assert.isNotNull(tokenContract)
            assert.isNotNull(saleContract)
            const tokenOwner = await tokenContract.owner.call()
            const saleOwner = await saleContract.owner.call()
            const tokenCrowdsale = await tokenContract.crowdsale.call()
            assert.equal(tokenOwner, owner)
            assert.equal(saleOwner, owner)
            assert.equal(tokenCrowdsale, saleContract.address)
        })

        it('has right settings', async () => {
            const name = await tokenContract.name.call()
            const symbol = await tokenContract.symbol.call()
            const decimals = await tokenContract.decimals.call()
            assert.equal(name, "GDPR Cash")
            assert.equal(symbol, "GDPR")
            assert.equal(decimals, 18)
        })

        it('distributed the initial token amounts correctly', async () => {
            // Get allocation wallet addresses   
            const expertsPool = await tokenContract.EXPERTS_POOL_ADDR.call()
            const marketingPool = await tokenContract.MARKETING_POOL_ADDR.call()
            const teamPool = await tokenContract.TEAM_POOL_ADDR.call()
            const legalExpenses = await tokenContract.LEGAL_EXPENSES_ADDR.call()
            const reservePool = await tokenContract.RESERVE_POOL_ADDR.call()

            // Get expected token amounts from contract config
            const expectedSaleTokens = await tokenContract.SALE_CAP.call()
            const expectedExpertsTokens = await tokenContract.EXPERTS_POOL_TOKENS.call()
            const expectedMarketingTokens = await tokenContract.MARKETING_POOL_TOKENS.call()
            const expectedTeamTokens = await tokenContract.TEAM_POOL_TOKENS.call()
            const expectedLegalTokens = await tokenContract.LEGAL_EXPENSES_TOKENS.call()
            const expectedReserveTokens = await tokenContract.RESERVE_POOL_TOKENS.call()

            // Get actual balances
            const saleBalance = await tokenContract.balanceOf(saleContract.address)
            const expertsBalance = await tokenContract.balanceOf.call(expertsPool)
            const marketingBalance = await tokenContract.balanceOf.call(marketingPool)
            const teamBalance = await tokenContract.balanceOf.call(teamPool)
            const legalBalance = await tokenContract.balanceOf.call(legalExpenses)
            const reserveBalance = await tokenContract.balanceOf.call(reservePool)

            // Check allocation was done as expected
            assert.equal(saleBalance.toNumber(), expectedSaleTokens.toNumber())
            assert.equal(expertsBalance.toNumber(), expectedExpertsTokens.toNumber())
            assert.equal(
                marketingBalance.toNumber(),
                expectedMarketingTokens.toNumber()
            )
            assert.equal(teamBalance.toNumber(), expectedTeamTokens.toNumber())
            assert.equal(legalBalance.toNumber(), expectedLegalTokens.toNumber())
            assert.equal(reserveBalance.toNumber(), expectedReserveTokens.toNumber())
        })

        it('cannot change start time if sale already started', async () => {
            await assertThrows(saleContract.setStartTime(start + 999))
        })

        it('allows token purchases', async () => {
            const sender = buyer3

            const saleInitialBalance = await web3.eth.getBalance(saleContract.address)
            const rate = await saleContract.rate.call()

            // send ETH to the contract to purchase tokens
            const sendAmount = web3.toWei(1, 'ether')
            await saleContract.sendTransaction({
                from: sender,
                value: sendAmount,
                gas: 200000
            })
            const buyerBalance = await tokenContract.balanceOf.call(sender)

            // check allocated amount corresponds to the set exchange rate according to ETH price
            assert.equal(buyerBalance.toNumber(), sendAmount * rate)

            // Check wei added to the vault is correct
            const saleNewBalance = await web3.eth.getBalance(saleContract.address)
            assert.equal(
                saleNewBalance.toNumber() - saleInitialBalance.toNumber(),
                sendAmount
            )
        })

        it('does not allow token purchases when paused', async () => {
            await saleContract.pause();
            let paused = await saleContract.paused.call()
            assert.equal(paused, true)

            const sender = buyer4
            const sendAmount = web3.toWei(1, 'ether')
            await assertThrows(
                saleContract.sendTransaction({
                    from: sender,
                    value: sendAmount,
                    gas: 200000
                })
            )

            await saleContract.unpause()
            paused = await saleContract.paused.call()
            assert.equal(paused, false)
        })

        it('does not allow contributions below minimum cap per purchaser', async () => {
            const sender = buyer4

            const minTokenCap = await tokenContract.PURCHASER_MIN_TOKEN_CAP.call()
            const rate = await saleContract.rate.call()
            const minWei = minTokenCap.toNumber() / rate.toNumber()
            const sendAmount = minWei - SIGNIFICANT_AMOUNT

            // check below cap transaction fails
            await assertThrows(
                saleContract.sendTransaction({ from: sender, value: sendAmount, gas: 200000 })
            )
        })

        it('does allow contributions above minimum purchaser cap', async () => {
            const sender = buyer4

            const minTokenCap = await tokenContract.PURCHASER_MIN_TOKEN_CAP.call()
            const rate = await saleContract.rate.call()
            const minWei = minTokenCap.toNumber() / rate.toNumber()
            const sendAmount = minWei + SIGNIFICANT_AMOUNT
            const balance1 = await tokenContract.balanceOf(sender)

            await saleContract.sendTransaction({
                from: sender,
                value: sendAmount,
                gas: 200000
            })
            const balance2 = await tokenContract.balanceOf(sender)
            assert.isAbove(balance2.toNumber(), balance1.toNumber())
        })

        it('does not allow presales after the ico has started', async () => {
            await assertThrows(
                saleContract.addPresaleOrder(buyer4, 5000)
            )
        })

        it('does not allow contributions above $2000 per purchaser on day 1', async () => {
            const sender = buyer4

            const maxTokenCap = await tokenContract.PURCHASER_MAX_TOKEN_CAP_DAY1.call()
            const rate = await saleContract.rate.call()
            const maxWei = maxTokenCap.toNumber() / rate.toNumber()
            const sendAmount = maxWei

            await assertThrows(
                saleContract.sendTransaction({ from: sender, value: sendAmount })
            )
        })

        it('allows contributions above $2000 after day 1', async () => {
            const sender = buyer4

            timeTravel(86400) // fast forward 1 day

            const maxTokenCap = await tokenContract.PURCHASER_MAX_TOKEN_CAP_DAY1.call()
            const rate = await saleContract.rate.call()
            const maxWei = maxTokenCap.toNumber() / rate.toNumber()
            const sendAmount = maxWei + SIGNIFICANT_AMOUNT
            const balance1 = await tokenContract.balanceOf(sender)

            await saleContract.sendTransaction({
                from: sender,
                value: sendAmount,
                gas: 200000
            })
            const balance2 = await tokenContract.balanceOf(sender)
            assert.isAbove(balance2.toNumber(), balance1.toNumber())
        })

        it('does not allow contributions above $20,000 after day 1', async () => {
            const sender = buyer5

            const maxTokenCap = await tokenContract.PURCHASER_MAX_TOKEN_CAP.call()
            const rate = await saleContract.rate.call()
            const maxWei = maxTokenCap.toNumber() / rate.toNumber()
            let sendAmount = maxWei + SIGNIFICANT_AMOUNT * 10

            // check transaction fails because purchase is above cap
            await assertThrows(
                saleContract.sendTransaction({ from: sender, value: sendAmount, gas: 200000 })
            )

            // check participant can still purchase slightly below the max cap
            sendAmount = maxWei - SIGNIFICANT_AMOUNT * 10
            const balance1 = await tokenContract.balanceOf(sender)
            saleContract.sendTransaction({ from: sender, value: sendAmount, gas: 200000 })
            const balance2 = await tokenContract.balanceOf(sender)
            assert.isAbove(balance2.toNumber(), balance1.toNumber())
        })

        it('does not allow updating the rate', async () => {
            const rate = await saleContract.rate.call()
            const newRate = rate.toNumber() + 100
            await saleContract.setRate(newRate)
            const changedRate = await saleContract.rate.call()
            assert.equal(changedRate, newRate)
        })

        it('can change the end date if sale has not ended', async () => {
            const additionalTime = 999
            const beforeEnd = await saleContract.endTime.call()
            await saleContract.setEndTime(beforeEnd.toNumber() + additionalTime)
            const laterEnd = await saleContract.endTime.call()
            assert.equal(laterEnd.toNumber(), beforeEnd.toNumber() + additionalTime)

            await assertThrows(saleContract.setEndTime(now - 999))
            await assertThrows(saleContract.setEndTime(start - 1))
        })

        it('cannot finalize before the crowdsale end', async () => {
            // can't finalize before the end date
            await assertThrows(saleContract.finalize())
        })

        it('does not allow contributions after end date', async () => {
            const sender = buyer

            const endedBefore = await saleContract.hasEnded()
            assert.equal(endedBefore, false)


            // fast forwards until crowdsale end time
            const untilEnd = end - now
            timeTravel(untilEnd)

            const endedAfter = await saleContract.hasEnded()
            assert.equal(endedAfter, true)

            // check transaction fails
            const sendAmount = web3.toWei(1, 'ether')
            await assertThrows(
                saleContract.sendTransaction({ from: sender, value: sendAmount, gas: 200000 })
            )
        })

        it('cannot change end time if sale has already ended', async () => {
            await assertThrows(saleContract.setEndTime(end + 999))
        })

        it('does not allow token transfers before crowdsale is finalized', async () => {
            const sender = buyer3
            const sendAmount = 5

            // check participant has enough token funds
            const balance = await tokenContract.balanceOf.call(sender)
            assert.isAtLeast(balance.toNumber(), sendAmount)

            // Tokens are not yet transferrable because sale has not been finalized
            await assertThrows(
                tokenContract.transfer(receiver, sendAmount, { from: sender })
            )
        })

        it('can finalize token sale successfully', async () => {
            const crowdsaleWallet = await tokenContract.SALE_FUNDS_ADDR.call()
            const saleBalance = web3.eth.getBalance(saleContract.address)
            const walletBalance1 = web3.eth.getBalance(crowdsaleWallet)

            // fast forwards until crowdsale end time
            //const untilEnd = end - now
            //timeTravel(untilEnd)

            // finalize token sale
            await saleContract.finalize()
            const walletBalance2 = web3.eth.getBalance(crowdsaleWallet)
            const saleBalance2 = web3.eth.getBalance(saleContract.address)
            const contractTokenBalance = await tokenContract.balanceOf.call(
                saleContract.address
            )

            // check unsold tokens were effectively burned
            assert.equal(contractTokenBalance, 0)

            // check all ETH was effectively transferred to the crowdsale wallet
            assert.equal(saleBalance2, 0)
            assert.equal(
                walletBalance2.toNumber(),
                walletBalance1.toNumber() + saleBalance.toNumber()
            )
        })

        it('does not allow finalize to be re-invoked', async () => {
            await assertThrows(saleContract.finalize())
        })

        it('enables token transfers after finalization', async () => {
            const sender = buyer3
            const sendAmount = 10 // GDPR

            // check sender has enough tokens
            const senderBalance = await tokenContract.balanceOf(sender)
            assert.isAtLeast(senderBalance, sendAmount)

            // test transfer method
            let receiverBalance1 = await tokenContract.balanceOf.call(receiver)
            await tokenContract.transfer(receiver, sendAmount, { from: sender })
            let receiverBalance2 = await tokenContract.balanceOf.call(receiver)
            assert.equal(
                receiverBalance2.toNumber() - receiverBalance1.toNumber(),
                sendAmount
            )

            // approve a middleman to make transfer on behalf of sender
            await tokenContract.approve(middleman, sendAmount, { from: sender })
            const senderBalance1 = await tokenContract.balanceOf.call(sender)
            receiverBalance1 = await tokenContract.balanceOf.call(receiver)

            // test unsuccessful transferFrom invocation (above the approved amount)
            await assertThrows(
                tokenContract.transferFrom(sender, receiver, sendAmount + 1, {
                    from: middleman
                })
            ) // function-paren-newline

            // test successful transferFrom invocation
            await tokenContract.transferFrom(sender, receiver, sendAmount, {
                from: middleman
            })
            const senderBalance2 = await tokenContract.balanceOf.call(sender)
            receiverBalance2 = await tokenContract.balanceOf.call(receiver)

            assert.equal(senderBalance1.minus(senderBalance2), sendAmount)
            assert.equal(receiverBalance2.minus(receiverBalance1), sendAmount)
        })
    })
})
