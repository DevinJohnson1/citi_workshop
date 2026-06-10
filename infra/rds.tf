# Subnet group is only required for real AWS VPC placement.
# LocalStack does not enforce subnet group membership for Aurora clusters.
resource "aws_db_subnet_group" "this" {
  count      = data.aws_caller_identity.this.id != "000000000000" && var.aws_postgres_enabled ? 1 : 0
  name       = format("%s-rds-subnet-group-%s", var.aws_project, local.app_id)
  subnet_ids = local.public_subnet_ids

  tags = local.app_tags
}

# Aurora cluster is provisioned in both LocalStack Pro and real AWS when
# aws_postgres_enabled = true. LocalStack Community does not support RDS —
# set aws_postgres_enabled = false when using Community edition.
resource "aws_rds_cluster" "this" {
  count              = var.aws_postgres_enabled ? 1 : 0
  cluster_identifier = format("%s-rds-%s", var.aws_project, local.app_id)
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned"
  # LocalStack Pro accepts the same engine_version string as real AWS.
  engine_version          = "17.7"
  master_username         = "superadmin"
  master_password         = random_pet.this.id
  database_name           = replace(var.aws_project, "-", "")
  backup_retention_period = 7
  preferred_backup_window = "07:00-09:00"
  skip_final_snapshot     = true
  storage_encrypted       = true
  # Subnet group only exists on real AWS; LocalStack ignores this field when null.
  db_subnet_group_name   = data.aws_caller_identity.this.id != "000000000000" ? element(aws_db_subnet_group.this.*.name, 0) : null
  vpc_security_group_ids = data.aws_security_groups.this.ids
  # CloudWatch log export is a no-op on LocalStack but harmless to declare.
  enabled_cloudwatch_logs_exports = ["postgresql"]

  # Serverless v2 scaling is only supported on real AWS; LocalStack ignores
  # the block but some provider versions reject it, so we make it conditional.
  dynamic "serverlessv2_scaling_configuration" {
    for_each = data.aws_caller_identity.this.id != "000000000000" ? [1] : []
    content {
      max_capacity = 4.0
      min_capacity = 0.0
    }
  }

  tags = local.app_tags
}

resource "aws_rds_cluster_instance" "this" {
  count              = var.aws_postgres_enabled ? 1 : 0
  cluster_identifier = element(aws_rds_cluster.this.*.id, count.index)
  engine             = element(aws_rds_cluster.this.*.engine, count.index)
  engine_version     = element(aws_rds_cluster.this.*.engine_version, count.index)
  identifier         = format("%s-rds-%s", var.aws_project, local.app_id)
  # db.serverless is only valid for real Aurora Serverless v2; LocalStack
  # accepts standard instance classes and maps them to its embedded Postgres.
  instance_class             = data.aws_caller_identity.this.id != "000000000000" ? "db.serverless" : "db.t3.medium"
  auto_minor_version_upgrade = true

  tags = local.app_tags
}
