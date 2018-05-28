const Membership = artifacts.require('./Membership.sol')
const Budgeting = artifacts.require('./Budgeting.sol')
const Voting = artifacts.require('./Voting.sol')

module.exports = (deployer, network, accounts) => {
    deployer
        .deploy([Membership, Budgeting, Voting])
}
